import { BigNumber } from 'bignumber.js';
import Web3 from 'web3';

// Types
import {
  ERC20,
  MarketCollateralPool,
  MarketContract,
  OrderFilledEvent,
  SignedOrder
} from '@marketprotocol/types';

import { Market, MARKETProtocolConfig, Utils } from '../src';
import { constants } from '../src/constants';

import { createEVMSnapshot, restoreEVMSnapshot } from './utils';

/**
 * Test contract fills history for a contract. One maker and multiple takers.
 * In the test setup two orders are created. First order is partially filled twice
 * by taker account, and once by taker2 account. Second order is partially filled
 * only by taker2 account. Subsequent test cases verify that getContractFillsAsync
 * returns correct data.
 */
describe('Contract Fills', () => {
  const web3 = new Web3(new Web3.providers.HttpProvider(constants.PROVIDER_URL_TRUFFLE));
  const config: MARKETProtocolConfig = {
    networkId: constants.NETWORK_ID_TRUFFLE
  };
  let market: Market;
  let contractAddress: string;
  let snapshotId: string;
  let signedOrder: SignedOrder;
  let signedOrder2: SignedOrder;
  let maker: string;
  let taker: string;
  let taker2: string;
  let orderHash: string;
  let orderHash2: string;
  let fillQty: number;
  let lastFill: OrderFilledEvent;

  beforeAll(async () => {
    jest.setTimeout(30000);
    snapshotId = await createEVMSnapshot(web3);
    market = new Market(web3.currentProvider, config);
    const contractAddresses: string[] = await market.marketContractRegistry.getAddressWhiteList;
    const expirationTimestamp = new BigNumber(Math.floor(Date.now() / 1000) + 60 * 60);
    const deploymentAddress = web3.eth.accounts[0];

    // contract, maker and takers
    contractAddress = contractAddresses[0];
    maker = web3.eth.accounts[1];
    taker = web3.eth.accounts[2];
    taker2 = web3.eth.accounts[3];

    const deployedMarketContract: MarketContract = await MarketContract.createAndValidate(
      web3,
      contractAddress
    );
    expect(await deployedMarketContract.isCollateralPoolContractLinked).toBe(true);
    expect(await deployedMarketContract.isSettled).toBe(false);

    const collateralTokenAddress: string = await deployedMarketContract.COLLATERAL_TOKEN_ADDRESS;
    const collateralToken: ERC20 = await ERC20.createAndValidate(web3, collateralTokenAddress);
    const initialCredit: BigNumber = new BigNumber(1e24);

    await collateralToken.transferTx(maker, initialCredit).send({ from: deploymentAddress });
    await collateralToken.transferTx(taker, initialCredit).send({ from: deploymentAddress });
    await collateralToken.transferTx(taker2, initialCredit).send({ from: deploymentAddress });

    const collateralPoolAddress = await deployedMarketContract.MARKET_COLLATERAL_POOL_ADDRESS;
    const collateralPool = await MarketCollateralPool.createAndValidate(
      web3,
      collateralPoolAddress
    );
    expect(await collateralPool.linkedAddress).toBe(deployedMarketContract.address);

    await collateralToken.approveTx(collateralPoolAddress, initialCredit).send({ from: maker });
    await collateralToken.approveTx(collateralPoolAddress, initialCredit).send({ from: taker });
    await collateralToken.approveTx(collateralPoolAddress, initialCredit).send({ from: taker2 });

    await market.depositCollateralAsync(contractAddress, initialCredit, { from: maker });
    await market.depositCollateralAsync(contractAddress, initialCredit, { from: taker });
    await market.depositCollateralAsync(contractAddress, initialCredit, { from: taker2 });

    const fees: BigNumber = new BigNumber(0);
    const orderQty: BigNumber = new BigNumber(10);
    const price: BigNumber = new BigNumber(100000);

    signedOrder = await market.createSignedOrderAsync(
      contractAddress,
      expirationTimestamp,
      constants.NULL_ADDRESS,
      maker,
      fees,
      constants.NULL_ADDRESS,
      fees,
      orderQty,
      price,
      Utils.generatePseudoRandomSalt(),
      false
    );

    signedOrder2 = await market.createSignedOrderAsync(
      contractAddress,
      expirationTimestamp,
      constants.NULL_ADDRESS,
      maker,
      fees,
      constants.NULL_ADDRESS,
      fees,
      orderQty,
      price,
      Utils.generatePseudoRandomSalt(),
      false
    );

    orderHash = market.getOrderHash(signedOrder);
    orderHash2 = market.getOrderHash(signedOrder2);

    expect(
      await market.getQtyFilledOrCancelledFromOrderAsync(contractAddress, orderHash.toString())
    ).toEqual(new BigNumber(0));

    fillQty = 2;

    await market.tradeOrderAsync(signedOrder, new BigNumber(fillQty), {
      from: taker,
      gas: 400000
    });
    await market.tradeOrderAsync(signedOrder, new BigNumber(fillQty), {
      from: taker2,
      gas: 400000
    });

    expect(
      await market.getQtyFilledOrCancelledFromOrderAsync(contractAddress, orderHash.toString())
    ).toEqual(new BigNumber(2 * fillQty));

    await market.tradeOrderAsync(signedOrder, new BigNumber(1), {
      from: taker2,
      gas: 400000
    });

    expect(
      await market.getQtyFilledOrCancelledFromOrderAsync(contractAddress, orderHash.toString())
    ).toEqual(new BigNumber(2 * fillQty + 1));

    await market.tradeOrderAsync(signedOrder2, new BigNumber(1), {
      from: taker2,
      gas: 400000
    });
    await market.tradeOrderAsync(signedOrder2, new BigNumber(2), {
      from: taker2,
      gas: 400000
    });
    await market.tradeOrderAsync(signedOrder2, new BigNumber(3), {
      from: taker2,
      gas: 400000
    });

    expect(
      await market.getQtyFilledOrCancelledFromOrderAsync(contractAddress, orderHash2.toString())
    ).toEqual(new BigNumber(1 + 2 + 3));

    const fills = await market.getContractFillsAsync(contractAddress);
    lastFill = fills[fills.length - 1];
  });

  afterAll(async () => {
    await restoreEVMSnapshot(web3, snapshotId);
  });

  it('Gets all fills for a contract', async () => {
    const fills = await market.getContractFillsAsync(contractAddress, '0x0', 'latest', null, 'any');
    expect(fills.length >= 6).toBeTruthy();

    const includes: boolean = fills.some(
      (e): boolean => {
        if (e.maker === maker && (e.taker === taker || e.taker === taker2)) {
          return true;
        }
        return false;
      }
    );
    expect(includes).toBe(true);
  });

  it('Gets all fills for a contract with default arguments', async () => {
    const fills = await market.getContractFillsAsync(contractAddress);
    expect(fills.length >= 6).toBeTruthy();

    const includes: boolean = fills.some(
      (e): boolean => {
        if (e.maker === maker && (e.taker === taker || e.taker === taker2)) {
          return true;
        }
        return false;
      }
    );
    expect(includes).toBe(true);
  });

  it('Gets all fills for a contract starting 10 blocks back', async () => {
    const fills = await market.getContractFillsAsync(
      contractAddress,
      lastFill.blockNumber - 10,
      'latest',
      null,
      'any'
    );
    expect(fills.length).toEqual(6); // three fills for two orders each

    const includes: boolean = fills.some(
      (e): boolean => {
        if (e.maker === maker && (e.taker === taker || e.taker === taker2)) {
          return true;
        }
        return false;
      }
    );
    expect(includes).toBe(true);
  });

  it('Gets all fills for a contract starting 10 blocks back with specific maker', async () => {
    const fills = await market.getContractFillsAsync(
      contractAddress,
      lastFill.blockNumber - 10,
      'latest',
      maker,
      'maker'
    );
    expect(fills.length).toEqual(6);

    const includes: boolean = fills.some(
      (e): boolean => {
        if (e.maker === maker && (e.taker === taker || e.taker === taker2)) {
          return true;
        }
        return false;
      }
    );
    expect(includes).toBe(true);
  });

  it('Gets all fills for a contract starting 10 blocks back with specific taker', async () => {
    let fills = await market.getContractFillsAsync(
      contractAddress,
      lastFill.blockNumber - 10,
      'latest',
      taker,
      'taker'
    );
    expect(fills.length).toEqual(1);

    let fills2 = await market.getContractFillsAsync(
      contractAddress,
      lastFill.blockNumber - 10,
      'latest',
      taker2,
      'taker'
    );
    expect(fills2.length).toEqual(5);

    const includes: boolean = fills2.every(
      (e): boolean => {
        if (e.maker === maker && e.taker === taker2) {
          return true;
        }
        return false;
      }
    );
    expect(includes).toBe(true);
  });

  it('Gets all fills for a contract starting 10 blocks back taken by a specific address', async () => {
    let makerFills = await market.getContractFillsAsync(
      contractAddress,
      lastFill.blockNumber - 10,
      'latest',
      maker,
      'any'
    );
    expect(makerFills.length).toEqual(6);

    let takerFills = await market.getContractFillsAsync(
      contractAddress,
      lastFill.blockNumber - 10,
      'latest',
      taker,
      'any'
    );
    expect(takerFills.length).toEqual(1);

    let taker2Fills = await market.getContractFillsAsync(
      contractAddress,
      lastFill.blockNumber - 10,
      'latest',
      taker2,
      'any'
    );
    expect(taker2Fills.length).toEqual(5);
  });

  it('Returns empty fills array for a contract when taker does not match', async () => {
    const fills = await market.getContractFillsAsync(
      contractAddress,
      lastFill.blockNumber - 10,
      'latest',
      maker,
      'taker'
    );
    expect(fills.length).toEqual(0);
  });
});
