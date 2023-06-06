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
  });


  beforeEach(async () => {
    [token[0], token[1], pool] = await Utils.createPool(routerContract, factoryContract, user[0]);
  });


  describe('liquidity', () => {
    it('can be deposited and withdrawn directly', async () => {
      let deposited = await Utils.depositLiquidity(
        user[0], 
        token[0], 
        token[1], 
        await token[0].balanceOf(user[0]), 
        await token[1].balanceOf(user[0]), 
      );

      // can be withdrawn directly
      let withdrawn = await Utils.withdrawLiquidity(user[0], token[0], token[1]);

      expect(withdrawn[0]).to.be.bignumber.above(deposited[0].mul(new BN(100000)).div(new BN(100001)));
      expect(withdrawn[1]).to.be.bignumber.above(deposited[1].mul(new BN(100000)).div(new BN(100001)));
    });
  });


  describe('swap', () => {
    let deposited;

    beforeEach(async () => {
      deposited = await Utils.resetTokensAndPool(user, token, pool, lpHolder);
      await rebateContract.setRebates([user[2]], [0], {from: deployerAccount});
    });


    it('can be done', async () => {
      const amountIn = '1'+'000000000000000000';
      await Utils.swap(routerContract, amountIn, token[0], token[1], user[0], user[2]);
    });


    it('with various levels of oasis share', async () => {
      const amountIn = '1'+'000000000000000000';
      const oasisShares = [0, 2500, 5000, 7500, 10000];
      const fee = 100;

      for (const oasisShare of oasisShares) {
        await pool.setFee(fee, oasisShare, {from: deployerAccount});
        await Utils.swap(routerContract, amountIn, token[0], token[1], user[0], user[2], fee/10000, oasisShare/10000);
        await Utils.resetTokensAndPool(user, token, pool, lpHolder);
      }
    });


    it('with various levels of pool fee', async () => {
      const amountIn = '1'+'000000000000000000';
      const oasisShare = 5000;
      const fees = [0, 25, 50, 75, 100];

      for (const fee of fees) {
        await pool.setFee(fee, oasisShare, {from: deployerAccount});
        await Utils.swap(routerContract, amountIn, token[0], token[1], user[0], user[2], fee/10000, oasisShare/10000);
        await Utils.resetTokensAndPool(user, token, pool, lpHolder);
      }
    });


    it('with various levels of pool fee and oasis share', async () => {
      const amountIn = '1'+'000000000000000000';
      const oasisShares = [0, 2500, 5000, 7500, 10000];
      const fees = [0, 25, 50, 75, 100];

      for (const fee of fees) {
        for (const oasisShare of oasisShares) {
          await pool.setFee(fee, oasisShare, {from: deployerAccount});
          await Utils.swap(routerContract, amountIn, token[0], token[1], user[0], user[2], fee/10000, oasisShare/10000);
          await Utils.resetTokensAndPool(user, token, pool, lpHolder);
        }
      }
    });


    it('with various levels of oasis share and rebates', async () => {
      const amountIn = '1'+'000000000000000000';
      const oasisShares = [0, 2500, 5000, 7500, 10000];
      const fee = 100;
      const rebates = [0, 2500, 5000, 7500, 10000];

      for (const rebate in rebates) {
        await rebateContract.setRebates([user[2]], [rebate], {from: deployerAccount});
        
        for (const oasisShare of oasisShares) {
          await pool.setFee(fee, oasisShare, {from: deployerAccount});
          await Utils.swap(routerContract, amountIn, token[0], token[1], user[0], user[2], (fee/10000)*((10000-rebate)/10000), oasisShare/10000, 1, true);
          await Utils.resetTokensAndPool(user, token, pool, lpHolder);
        }
      }
    });


    it('with various levels of pool fee and rebates', async () => {
      const amountIn = '1'+'000000000000000000';
      const oasisShare = 5000;
      const fees = [0, 25, 50, 75, 100];
      const rebates = [0, 2500, 5000, 7500, 10000];

      for (const rebate in rebates) {
        await rebateContract.setRebates([user[2]], [rebate], {from: deployerAccount});
        
        for (const fee of fees) {
          await pool.setFee(fee, oasisShare, {from: deployerAccount});
          await Utils.swap(routerContract, amountIn, token[0], token[1], user[0], user[2], (fee/10000)*((10000-rebate)/10000), oasisShare/10000, 1, true);
          await Utils.resetTokensAndPool(user, token, pool, lpHolder);
        }
      }
    });
  });


  describe('multistep swap', () => {
    let deposited;
    let tokenC;
    let tokenD;

    beforeEach(async () => {
      deposited = await Utils.resetTokensAndPool(user, token, pool, lpHolder);
      await rebateContract.setRebates([user[2]], [0], {from: deployerAccount});

      tokenC = await ERC20Mock.new('C', 'CCC', '100'+'000000'+'000000000000000000', {from: deployerAccount});
      tokenD = await ERC20Mock.new('D', 'DDD', '100'+'000000'+'000000000000000000', {from: deployerAccount});

      await factoryContract.createPair(token[1].address, tokenC.address);
      let pairBC = await OasisSwapPair.at(await factoryContract.getPair(token[1].address, tokenC.address));
      await token[1].transfer(pairBC.address, '20'+'000000'+'000000000000000000', {from: user[1]});
      await tokenC.transfer(pairBC.address, '20'+'000000'+'000000000000000000', {from: deployerAccount});
      await pairBC.mint(deployerAccount, {from: deployerAccount});

      await factoryContract.createPair(tokenC.address, tokenD.address);
      let pairCD = await OasisSwapPair.at(await factoryContract.getPair(tokenC.address, tokenD.address));
      await tokenC.transfer(pairCD.address, '20'+'000000'+'000000000000000000', {from: deployerAccount});
      await tokenD.transfer(pairCD.address, '20'+'000000'+'000000000000000000', {from: deployerAccount});
      await pairCD.mint(deployerAccount, {from: deployerAccount});
    });


    it('A -> B -> C', async () => {
      const amountIn = '1'+'000000000000000000';
      const path = [token[0].address, token[1].address, tokenC.address];
      const deadline = '9999999999999';
      const useRebate = false;
      const amounts = await routerContract.getAmountsOut(amountIn, path, useRebate);
      const amountOut = amounts[2];
      expect(amountOut).to.be.bignumber.above(new BN('0'));

      const preSwapBalance = await tokenC.balanceOf(deployerAccount);
      await token[0].approve(routerContract.address, '100'+'000000'+'000000000000000000', {from: user[0]});
      await routerContract.swapExactTokensForTokens(amountIn, amountOut, path, deployerAccount, deadline, useRebate, {from: user[0]});
      const postSwapBalance = await tokenC.balanceOf(deployerAccount);
      expect(postSwapBalance.sub(preSwapBalance)).to.be.bignumber.equal(amountOut);
    });


    it('A -> B -> C -D', async () => {
      const amountIn = '1'+'000000000000000000';
      const path = [token[0].address, token[1].address, tokenC.address, tokenD.address];
      const deadline = '9999999999999';
      const useRebate = false;
      const amounts = await routerContract.getAmountsOut(amountIn, path, useRebate);
      const amountOut = amounts[3];
      expect(amountOut).to.be.bignumber.above(new BN('0'));

      const preSwapBalance = await tokenD.balanceOf(deployerAccount);
      await token[0].approve(routerContract.address, '100'+'000000'+'000000000000000000', {from: user[0]});
      await routerContract.swapExactTokensForTokens(amountIn, amountOut, path, deployerAccount, deadline, useRebate, {from: user[0]});
      const postSwapBalance = await tokenD.balanceOf(deployerAccount);
      expect(postSwapBalance.sub(preSwapBalance)).to.be.bignumber.equal(amountOut);
    });
  });
});