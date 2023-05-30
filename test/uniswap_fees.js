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


contract('OasisSwap', (accounts) => {
  let factoryContract;
  let routerContract;

  let deployerAccount;
  let masterChefV2Contract;

  let user;
  let token = [];
  let lpHolder;


  before(async () => {
    factoryContract = await OasisSwapFactory.deployed();
    routerContract = await OasisSwapRouter.deployed();

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
  });


  beforeEach(async () => {
    [token[0], token[1], pool] = await Utils.createPool(routerContract, factoryContract, user[0]);
  });


  describe('fees', () => {
    let deposited;


    beforeEach(async () => {
      deposited = await Utils.resetTokensAndPool(user, token, pool, lpHolder);
    });


    /*
    it('there are rewards for LP holders in one direction', async () => {
      // TODO figure out how to test gains in just one direction
      const isTokensFlipped = (await pool.token0()) == token[1].address;
      let preFeeCache = [
        await pool.feeCache0(),
        await pool.feeCache1(),
      ];
      preFeeCache = isTokensFlipped ? [preFeeCache[1], preFeeCache[0]] : preFeeCache;

      // swap in one direction
      const amountIn = '1'+'000000000000000000';
      let amountOut = new BN(0)
      for (let i = 0;  i < 10;  ++i) {
        amountOut = amountOut.add(await Utils.swap(routerContract, amountIn, token[0], token[1], user[0], user[2],));
      }

      // check that the pool has some withheld rewards
      let postFeeCache = [
        await pool.feeCache0(),
        await pool.feeCache1(),
      ];
      postFeeCache = isTokensFlipped ? [postFeeCache[1], postFeeCache[0]] : postFeeCache;
      //console.log('postFeeCache', postFeeCache.map(value => value.toString()));
      //console.log('fee', (await pool.fee()).toString());
      //console.log('oasisFeeProportion', (await pool.oasisFeeProportion()).toString());
      expect(postFeeCache[0].sub(preFeeCache[0])).to.be.bignumber.equals(new BN(amountIn).mul(new BN(10)).div(new BN(2*100)));
      expect(postFeeCache[1].sub(preFeeCache[1])).to.be.bignumber.equals(new BN(0));

      // withdraw and check gains on LP
      const withdrawn = await Utils.withdrawLiquidity(lpHolder, token[0], token[1]);
      withdrawn[0] = withdrawn[0].sub(new BN(amountIn).mul(new BN(10)).sub(postFeeCache[0].sub(preFeeCache[0]))); // remove directly trade related changes
      withdrawn[1] = withdrawn[1].add(amountOut); // remove directly trade related changes
      decimals = 1000000;
      gains = withdrawn.map((value, i) => value.sub(deposited[i]).mul(new BN(decimals)).div(new BN(amountIn)).toNumber() / decimals);
      console.log('gains', gains);
      expect(gains[0]).to.be.closeTo(0.005*10, 0.00001);
      expect(gains[1]).to.be.closeTo(0.005*0, 0.00001);
    });
    */


    it('there are rewards for LP holders in both directions', async () => {
      const isTokensFlipped = (await pool.token0()) == token[1].address;
      let preFeeCache = [
        await pool.feeCache0(),
        await pool.feeCache1(),
      ];
      preFeeCache = isTokensFlipped ? [preFeeCache[1], preFeeCache[0]] : preFeeCache;

      // swap in one direction
      const amountIn = '1'+'000000000000000000';
      for (let i = 0;  i < 10;  ++i) {
        await Utils.swap(routerContract, amountIn, token[0], token[1], user[0], user[2],);
      }

      // check that the pool has some withheld rewards
      let postFeeCache = [
        await pool.feeCache0(),
        await pool.feeCache1(),
      ];
      postFeeCache = isTokensFlipped ? [postFeeCache[1], postFeeCache[0]] : postFeeCache;
      //console.log('postFeeCache', postFeeCache.map(value => value.toString()));
      //console.log('fee', (await pool.fee()).toString());
      //console.log('oasisFeeProportion', (await pool.oasisFeeProportion()).toString());
      expect(postFeeCache[0].sub(preFeeCache[0])).to.be.bignumber.equals(new BN(amountIn).mul(new BN(10)).div(new BN(2*100)));
      expect(postFeeCache[1].sub(preFeeCache[1])).to.be.bignumber.equals(new BN(0));

      // swap in other direction
      for (let i = 0;  i < 10;  ++i) {
        await Utils.swap(routerContract, amountIn, token[1], token[0], user[1], user[2]);
      }

      // check that the pool has some withheld rewards
      let postFeeCache2 = [
        await pool.feeCache0(),
        await pool.feeCache1(),
      ];
      postFeeCache2 = isTokensFlipped ? [postFeeCache2[1], postFeeCache2[0]] : postFeeCache2;
      expect(postFeeCache2[0].sub(postFeeCache[0])).to.be.bignumber.equals(new BN(0));
      expect(postFeeCache2[1].sub(postFeeCache[1])).to.be.bignumber.equals(new BN(amountIn).mul(new BN(10)).div(new BN(2*100)));

      // withdraw and check gains on LP
      const withdrawn = await Utils.withdrawLiquidity(lpHolder, token[0], token[1]);
      decimals = 10000000;
      gains = withdrawn.map((value, i) => value.sub(deposited[i]).mul(new BN(decimals)).div(new BN(amountIn)).toNumber() / decimals);
      //console.log('gains', gains);
      expect(gains[0]).to.be.closeTo(0.005*10, 0.00001);
      expect(gains[1]).to.be.closeTo(0.005*10, 0.00001);
    });
  });
});