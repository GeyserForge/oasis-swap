const { BigNumber } = require('bignumber.js');
const { BN, constants, expectEvent, time } = require('@openzeppelin/test-helpers');
const { expect } = require('chai');
const ERC20Mock = artifacts.require("ERC20Mock");
const OasisSwapPair = artifacts.require("OasisSwapPair");

const chai = require('chai');
// Enable and inject BN dependency
chai.use(require('chai-bn')(BN));
//chai.use(require('chai-bignumber')(BN));


async function createPool(routerContract, factoryContract, account) {
  tokenA = await ERC20Mock.new('A', 'AAA', '100'+'000000'+'000000000000000000', {from: account});
  tokenB = await ERC20Mock.new('B', 'BBB', '100'+'000000'+'000000000000000000', {from: account});

  let amountA = '100'+'000000000000000000';
  let amountB = '50'+'000000000000000000';
  await tokenA.approve(routerContract.address, amountA, {from: account});
  await tokenB.approve(routerContract.address, amountB, {from: account});
  //console.log(await factoryContract.pairCodeHash());

  /*
  await routerContract.addLiquidity(tokenA.address, tokenB.address, amountA, amountB, '0', '0', account, '9999999999999999999999999', {from: account});
  */
  await factoryContract.createPair(tokenA.address, tokenB.address);
  let lpContract = await OasisSwapPair.at(await factoryContract.getPair(tokenA.address, tokenB.address));
  return [tokenA, tokenB, lpContract];
}
exports.createPool = createPool;


async function advanceBlock() {
  // TODO replace this with an ETH send or something
  await ERC20Mock.new('X', 'X', '1');
}
exports.advanceBlock = advanceBlock;


async function advanceBlocks(count) {
  // await ethers.provider.getBlockNumber()
  for (let i = 0; i < count; i++) {
    await advanceBlock()
  }
}
exports.advanceBlocks = advanceBlocks;


async function expectRevert(func, expectedError) {
  try {
    await func;
  } catch (e) {
    if (e.reason != expectedError) {
      console.log(e)
      throw Error('Caused error "' + e.reason + '" instead of "' + expectedError + '" as expected');
    } else {
      return; // success
    }
  }
  throw Error("Didn't revert");
}
exports.expectRevert = expectRevert;


async function swap(routerContract, amountIn, token0, token1, fromUser, toUser, expectedFee = 0.01, expectedOasisShare = 0.5, expectedExchangeRate = 1, useRebate = false) {
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
  const amountOut = amounts[1];
  //console.log('amountIn/Out', amountIn, amountOut.toString(), new BN(amountOut).mul(new BN(100000)).div(new BN(amountIn)).toNumber()/100000);
  await routerContract.swapExactTokensForTokens(amountIn, amountOut, path, toUser, deadline, useRebate, {from: fromUser});

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

  //console.log('postFeeCache', postFeeCache.map(value => value.toString()));
  //console.log('fee', (await pool.fee()).toString());

  // validating pool share of fee happens implicitly via oasisshare and amountOut

  return amountOut;
}
exports.swap = swap;


async function resetTokensAndPool(user, token, pool, lpHolder) {
  // drain liquidity
  const poolBalance = await pool.balanceOf(lpHolder);
  if (poolBalance.gt(new BN(0))) {
    await pool.transfer(pool.address, poolBalance, {from: lpHolder});
    await pool.burn(lpHolder);
  }
  await pool.skim(lpHolder);

  // flush all token balances, each user gets all of their respective index token
  //console.log('token', token.map(value => value.address))
  //console.log('user', user)
  for (let userId = 0;  userId < 5;  ++userId) {
    for (let tokenId = 0;  tokenId < 2;  ++tokenId) {
      if (userId == tokenId) {
        continue;
      }
      let drainee = user[userId];
      if (userId == 4) {
        drainee = lpHolder;
      }
      //console.log('drainee', drainee);
      //console.log('userId', userId);
      //console.log('tokenId', tokenId);
      await token[tokenId].transfer(user[tokenId], await token[tokenId].balanceOf(drainee), {from: drainee});
    }
  }

  // create liquidity
  const depositAmounts = (await Promise.all(token.map(value => value.totalSupply()))).map(value => value.div(new BN(2)))
  await token[0].transfer(lpHolder, depositAmounts[0], {from: user[0]});
  await token[1].transfer(lpHolder, depositAmounts[1], {from: user[1]});
  return depositLiquidity(lpHolder, token[0], token[1], depositAmounts[0], depositAmounts[1]);
}
exports.resetTokensAndPool = resetTokensAndPool;


async function depositLiquidity(depositor, token0, token1, amount0, amount1) {
  //console.log('depositLiquidity', depositor, token0.address, token1.address, amount0.toString(), amount1.toString());
  // deposit for staking
  const preBalance = await Promise.all([token0, token1].map(value => value.balanceOf(depositor)));
  expect(preBalance[0]).to.be.bignumber.above(new BN(0));
  expect(preBalance[1]).to.be.bignumber.above(new BN(0));
  await Promise.all([token0, token1].map((value, i) => value.transfer(pool.address, [amount0, amount1][i], {from: depositor})))
  const postBalance = await Promise.all([token0, token1].map(value => value.balanceOf(depositor)));
  // validate deposit, +- some rounding error
  // TODO actually put this to use through the router
  expect(preBalance[0].sub(postBalance[0])).to.be.bignumber.above(amount0.sub(new BN(100))).below(amount0.add(new BN(100)));
  expect(preBalance[1].sub(postBalance[1])).to.be.bignumber.above(amount1.sub(new BN(100))).below(amount1.add(new BN(100)));

  // validate minting
  const preLpBalance = await pool.balanceOf(depositor);
  expect(preLpBalance).to.be.bignumber.equals('0');
  await pool.mint(depositor, {from: depositor});
  const postLpBalance = await pool.balanceOf(depositor);
  expect(postLpBalance).to.be.bignumber.above(preLpBalance);

  return preBalance.map((value, i) => value.sub(postBalance[i]));
}
exports.depositLiquidity = depositLiquidity;


async function withdrawLiquidity(depositor, token0, token1) {
  const preBalance = await Promise.all([token0, token1].map(value => value.balanceOf(depositor)));
  // deposit and burn
    await pool.transfer(pool.address, await pool.balanceOf(depositor), {from: depositor});
    await pool.burn(depositor);
    expect(await pool.balanceOf(depositor)).to.be.bignumber.equals('0');
    const postBurnBalance = await Promise.all([token0, token1].map(value => value.balanceOf(depositor)));
    const withdrawnAmounts = postBurnBalance.map((value, i) => value.sub(preBalance[i]))
    // compensate for minimum liquidity that is always held
    return withdrawnAmounts;
}
exports.withdrawLiquidity = withdrawLiquidity;


