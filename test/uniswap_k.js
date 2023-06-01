const MigrationUtils = require('../migrations/utils/utils.js');
const Utils = require('./utils.js');
const { BigNumber } = require('bignumber.js');
const { BN, constants, expectEvent, time, /*expectRevert*/ } = require('@openzeppelin/test-helpers');
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
  });


  beforeEach(async () => {
    [token[0], token[1], pool] = await Utils.createPool(routerContract, factoryContract, user[0]);
  });


  async function directSwap(amountIn, outAdjustment, token0, token1, fromUser, toUser, expectedFee = 0.01, expectedOasisShare = 0.5, expectedExchangeRate = 1, useRebate = false) {
    // approve token transfer to OasisSwap router
    await token0.approve(routerContract.address, amountIn, {from: fromUser});
    const preSwapBalance0 = await Promise.all([token0, token1].map(value => value.balanceOf(fromUser)));
    const preSwapBalance1 = await Promise.all([token0, token1].map(value => value.balanceOf(toUser)));
    expect(await token0.balanceOf(fromUser)).to.be.bignumber.above(amountIn);
    expect(await token0.allowance(fromUser, routerContract.address)).to.be.bignumber.equals(amountIn);
  
    let isTokensFlipped = (await pool.token0()) == token1.address;
    let preFeeCache = [
      await pool.feeCache0(),
      await pool.feeCache1(),
    ];
    preFeeCache = isTokensFlipped ? [preFeeCache[1], preFeeCache[0]] : preFeeCache;
  
    // perform swap
    const path = [token0.address, token1.address];
    const deadline = '9999999999999';
    const amounts = await routerContract.getAmountsOut(amountIn, path, false);
    const amountOut = amounts[1].add(outAdjustment);
    await token0.transfer(pool.address, amountIn, {from: fromUser});
    await pool.swap(
      isTokensFlipped ? amountOut : 0, 
      isTokensFlipped ? 0 : amountOut, 
      toUser, '0x', {from: fromUser}
    );
  
    // check token balances after swap
    const postSwapBalance0 = await Promise.all([token0, token1].map(value => value.balanceOf(fromUser)));
    expect(postSwapBalance0[0]).to.be.bignumber.above('0').below(preSwapBalance0[0]);
    expect(postSwapBalance0[1]).to.be.bignumber.equals('0');
    const postSwapBalance1 = await Promise.all([token0, token1].map(value => value.balanceOf(toUser)));
    expect(postSwapBalance1[0].sub(preSwapBalance1[0])).to.be.bignumber.equals('0');
    expect(postSwapBalance1[1].sub(preSwapBalance1[1])).to.be.bignumber.equals(amountOut);
  
    //console.log(amountOut / amountIn, expectedExchangeRate, 1-expectedFee, expectedFee);
    expect(amountOut / amountIn).to.be.closeTo(expectedExchangeRate*(1-expectedFee), 0.00001);
  
    let postFeeCache = [
      await pool.feeCache0(),
      await pool.feeCache1(),
    ];
    postFeeCache = isTokensFlipped ? [postFeeCache[1], postFeeCache[0]] : postFeeCache;
    expect(postFeeCache[0].sub(preFeeCache[0])).to.be.bignumber.at.least(new BN(amountIn).mul(new BN(Math.floor(1000000*expectedFee*expectedOasisShare))).div(new BN(1000000)))
  
    return amountOut;
  }
  

  describe('K-restriction', () => {
    let deposited;

    beforeEach(async () => {
      deposited = await Utils.resetTokensAndPool(user, token, pool, lpHolder);
      await rebateContract.setRebates([user[2]], [0], {from: deployerAccount});
    });


    it('spot-on', async () => {
      const amountIn = '1'+'000000000000000000';
      await directSwap(amountIn, new BN(0), token[0], token[1], user[0], user[2]);
    });


    it('under limit', async () => {
      const amountIn = '1'+'000000000000000000';
      await directSwap(amountIn, new BN(-1), token[0], token[1], user[0], user[2]);
      await directSwap(amountIn, new BN(-10), token[0], token[1], user[0], user[2]);
      await directSwap(amountIn, new BN(-100), token[0], token[1], user[0], user[2]);
    });


    it('beyond limit', async () => {
      const amountIn = '1'+'000000000000000000';
      await expectRevert(
        directSwap(amountIn, new BN(1), token[0], token[1], user[0], user[2]),
        'OasisSwap: K'
      );

      await pool.skim(user[0]);
      await expectRevert(
        directSwap(amountIn, new BN(10), token[0], token[1], user[0], user[2]),
        'OasisSwap: K'
      );

      await pool.skim(user[0]);
      await expectRevert(
        directSwap(amountIn, new BN(100), token[0], token[1], user[0], user[2]),
        'OasisSwap: K'
      );
    });
  });
});