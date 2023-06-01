const MigrationUtils = require('../migrations/utils/utils.js');
const Utils = require('./utils.js');
const { BigNumber } = require('bignumber.js');
const { BN, constants, expectEvent, time } = require('@openzeppelin/test-helpers');
const { expect } = require('chai');
const { mockSetup, expectRevert } = require('./utils.js')
//const { setupUFragmentsERC20, isEthException, closeCheck } = require('./helper');

const chai = require('chai');
// Enable and inject BN dependency
chai.use(require('chai-bn')(BN));
//chai.use(require('chai-bignumber')(BN));


const OasisSwapFactory = artifacts.require("OasisSwapFactory");
const OasisSwapRouter = artifacts.require("OasisSwapRouter");
const ERC20Mock = artifacts.require("ERC20Mock");
const OasisSwapPair = artifacts.require("OasisSwapPair");
const FixedRebate = artifacts.require("FixedRebate");
const WETH9Mock = artifacts.require("WETH9Mock");


contract('OasisSwap', (accounts) => {
  let factoryContract;
  let routerContract;
  let rebateContract;

  let deployerAccount;

  let user;
  let token = [];
  let lpHolder;


  before(async () => {
    // local
    const wethContract = await WETH9Mock.new();
    factoryContract = await OasisSwapFactory.new();
    routerContract = await OasisSwapRouter.new(factoryContract.address, wethContract.address);
    await factoryContract.setFeeManager(routerContract.address, true);

    // ganache fork from arbitrum one
    //factoryContract = await OasisSwapFactory.at('0xbC467D80AD6401dC25B37EB86F5fcd048Ae4BF6d');
    //routerContract = await OasisSwapRouter.at('0x5BF51Bf7aF925306866d6CF87B4B85189df67970');

    // default
    //factoryContract = await OasisSwapFactory.deployed();
    //routerContract = await OasisSwapRouter.deployed();

    deployerAccount = accounts[0];
    //console.log('deployerAccount', deployerAccount);
    //console.log('owner', (await factoryContract.owner()));
    user = [
      accounts[1],
      accounts[2],
      accounts[3],
      accounts[4],
    ];
    lpHolder = accounts[5];

    // allow deployer to change fees for pools
    await factoryContract.setFeeManager(deployerAccount, true, {from: deployerAccount});

    // deploy rebate manager
    rebateContract = await FixedRebate.new()
    await factoryContract.setRebateManager(rebateContract.address, {from: deployerAccount});
    await factoryContract.setRebateApprovedRouter(routerContract.address, true, {from: deployerAccount});
    await factoryContract.setFeeManager(user[3], true);
  });


  beforeEach(async () => {
    [token[0], token[1], pool] = await Utils.createPool(routerContract, factoryContract, user[0]);
  });


  describe('withdrawFee', () => {
    let deposited;

    beforeEach(async () => {
      deposited = await Utils.resetTokensAndPool(user, token, pool, lpHolder);
      await rebateContract.setRebates([user[2]], [0], {from: deployerAccount});
    });


    it('can be used', async () => {
      const amountIn = '1'+'000000000000000000';
      await Utils.swap(routerContract, amountIn, token[0], token[1], user[0], user[2]);

      const isTokensFlipped = (await pool.token0()) == token[1].address;
      let preFeeCache = [
        await pool.feeCache0(),
        await pool.feeCache1(),
      ];
      preFeeCache = isTokensFlipped ? [preFeeCache[1], preFeeCache[0]] : preFeeCache;
      expect(preFeeCache[0]).to.be.bignumber.above(new BN(0));
      expect(preFeeCache[1]).to.be.bignumber.equals(new BN(0));

      const preUserBalance = await Promise.all(token.map(value => value.balanceOf(user[3])));

      await pool.withdrawFee(user[3], true, true, {from: user[3]});

      const postUserBalance = await Promise.all(token.map(value => value.balanceOf(user[3])));

      let postFeeCache = [
        await pool.feeCache0(),
        await pool.feeCache1(),
      ];
      postFeeCache = isTokensFlipped ? [postFeeCache[1], postFeeCache[0]] : postFeeCache;
      expect(postFeeCache[0]).to.be.bignumber.equals(new BN(0));
      expect(postFeeCache[1]).to.be.bignumber.equals(new BN(0));

      expect(postUserBalance[0].sub(preUserBalance[0])).to.be.bignumber.equals(preFeeCache[0]);
      expect(postUserBalance[1].sub(preUserBalance[1])).to.be.bignumber.equals(preFeeCache[1]);
    });


    it('is only for approved users', async () => {
      await expectRevert(
        pool.withdrawFee(user[0], true, true, {from: user[0]}),
        'OasisSwap: FORBIDDEN'
      );
    });
  });
});