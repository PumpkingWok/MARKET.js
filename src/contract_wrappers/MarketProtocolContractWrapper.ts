import BigNumber from 'bignumber.js';
import * as _ from 'lodash';
import Web3 from 'web3';

// Types
import {
  ERC20,
  ITxParams,
  MarketCollateralPool,
  MarketContract,
  MarketToken,
  Order,
  SignedOrder
} from '@marketprotocol/types';
import { MarketError } from '../types';
import { ERC20TokenContractWrapper } from './ERC20TokenContractWrapper';
import { Utils } from '../lib/Utils';
import { constants } from '../constants';
import { createOrderHashAsync, isValidSignatureAsync } from '../lib/Order';
import { OrderTransactionInfo } from '../lib/OrderTransactionInfo';
import { assert } from '../assert';
import { MarketProtocolContractSetWrapper } from './MarketProtocolContractSetWrapper';
import { Market } from '../Market';
import * as Decoder from 'ethereum-input-data-decoder';
import { Transaction } from '@0xproject/types';

export interface CollateralEvent {
  type: string;
  from: string | null;
  to: string | null;
  amount: BigNumber;
  blockNumber: number | null;
  txHash: string;
}

/**
 * Wrapper for our MarketContract objects.  This wrapper exposes all needed functionality of the
 * MarketContract itself and stores the created MarketContract objects in a mapping for easy reuse.
 */
export class MarketProtocolContractWrapper {
  // region Members
  // *****************************************************************
  // ****                     Members                             ****
  // *****************************************************************

  protected readonly _web3: Web3;
  protected readonly _marketProtocolSetByMarketContractAddress: {
    [address: string]: MarketProtocolContractSetWrapper;
  };

  protected readonly _marketProtocolSetByMarketCollateralPoolAddress: {
    [address: string]: MarketProtocolContractSetWrapper;
  };

  protected readonly _erc20TokenContractWrapper: ERC20TokenContractWrapper;
  protected readonly _market: Market;

  // endregion // members
  // region Constructors
  // *****************************************************************
  // ****                     Constructors                        ****
  // *****************************************************************

  constructor(web3: Web3, market: Market) {
    this._web3 = web3;
    this._market = market;
    this._erc20TokenContractWrapper = market.erc20TokenContractWrapper;
    this._marketProtocolSetByMarketContractAddress = {};
    this._marketProtocolSetByMarketCollateralPoolAddress = {};
  }
  // endregion//Constructors

  // region Public Methods
  // *****************************************************************
  // ****                     Public Methods                      ****
  // *****************************************************************
  /**
   * Cancels an order in the given quantity.
   *
   * @param   order                           The order you wish to cancel.
   * @param   cancelQty                       The amount of the order that you wish to fill.
   * @param   txParams                        Transaction params of web3.
   * @returns {Promise<OrderTransactionInfo>} Information about this order transaction.
   */
  public async cancelOrderAsync(
    order: Order,
    cancelQty: BigNumber,
    txParams: ITxParams = {}
  ): Promise<OrderTransactionInfo> {
    const contractSetWrapper: MarketProtocolContractSetWrapper = await this._getContractSetByMarketContractAddressAsync(
      order.contractAddress
    );
    const txHash: string = await contractSetWrapper.marketContract
      .cancelOrderTx(
        [order.maker, order.taker, order.feeRecipient],
        [order.makerFee, order.takerFee, order.price, order.expirationTimestamp, order.salt],
        order.orderQty,
        cancelQty
      )
      .send(txParams);

    const blockNumber: number = Number(this._web3.eth.getTransaction(txHash).blockNumber);
    return new OrderTransactionInfo(contractSetWrapper.marketContract, order, txHash, blockNumber);
  }

  /**
   * Trades an order and returns success or error.
   * @param {MarketToken} mktTokenContract
   * @param {string} orderLibAddress          Address of the deployed OrderLib.
   * @param   signedOrder                     An object that conforms to the SignedOrder interface. The
   *                                          signedOrder you wish to validate.
   * @param   fillQty                         The amount of the order that you wish to fill.
   * @param   txParams                        Transaction params of web3.
   * @returns {Promise<OrderTransactionInfo>} Information about this order transaction.
   */
  public async tradeOrderAsync(
    mktTokenContract: MarketToken,
    orderLibAddress: string,
    signedOrder: SignedOrder,
    fillQty: BigNumber,
    txParams: ITxParams = {}
  ): Promise<OrderTransactionInfo> {
    assert.isETHAddressHex('orderLibAddress', orderLibAddress);
    // assert.isSchemaValid('SignedOrder', signedOrder, schemas.SignedOrderSchema);

    const contractSetWrapper: MarketProtocolContractSetWrapper = await this._getContractSetByMarketContractAddressAsync(
      signedOrder.contractAddress
    );

    const isContractSettled = await contractSetWrapper.marketContract.isSettled;
    if (isContractSettled) {
      return Promise.reject(new Error(MarketError.ContractAlreadySettled));
    }

    const maker = signedOrder.maker;
    const taker = txParams.from ? txParams.from : constants.NULL_ADDRESS;

    if (signedOrder.taker !== constants.NULL_ADDRESS && signedOrder.taker !== taker) {
      return Promise.reject(new Error(MarketError.InvalidTaker));
    }

    if (signedOrder.expirationTimestamp.isLessThan(Utils.getCurrentUnixTimestampSec())) {
      return Promise.reject(new Error(MarketError.OrderExpired));
    }

    if (signedOrder.remainingQty.isEqualTo(new BigNumber(0))) {
      return Promise.reject(new Error(MarketError.OrderFilledOrCancelled));
    }

    if (signedOrder.orderQty.isPositive() !== fillQty.isPositive()) {
      return Promise.reject(new Error(MarketError.BuySellMismatch));
    }

    const orderHash = await createOrderHashAsync(
      this._web3.currentProvider,
      orderLibAddress,
      signedOrder
    );

    const validSignature = await isValidSignatureAsync(
      this._web3.currentProvider,
      orderLibAddress,
      signedOrder,
      orderHash
    );

    if (!validSignature) {
      return Promise.reject(new Error(MarketError.InvalidSignature));
    }

    const isMakerEnabled = await mktTokenContract.isUserEnabledForContract(
      signedOrder.contractAddress,
      maker
    );
    const isTakerEnabled = await mktTokenContract.isUserEnabledForContract(
      signedOrder.contractAddress,
      taker
    );

    if (!isMakerEnabled || !isTakerEnabled) {
      return Promise.reject(new Error(MarketError.UserNotEnabledForContract));
    }

    const erc20ContractWrapper: ERC20TokenContractWrapper = new ERC20TokenContractWrapper(
      this._web3
    );

    const makerMktBalance: BigNumber = new BigNumber(
      await erc20ContractWrapper.getBalanceAsync(mktTokenContract.address, maker)
    );

    if (makerMktBalance.isLessThan(signedOrder.makerFee)) {
      return Promise.reject(new Error(MarketError.InsufficientBalanceForTransfer));
    }

    const makersMktAllowance = new BigNumber(
      await erc20ContractWrapper.getAllowanceAsync(
        mktTokenContract.address,
        maker,
        signedOrder.feeRecipient
      )
    );

    if (makersMktAllowance.isLessThan(signedOrder.makerFee)) {
      return Promise.reject(new Error(MarketError.InsufficientAllowanceForTransfer));
    }

    const takerMktBalance: BigNumber = new BigNumber(
      await erc20ContractWrapper.getBalanceAsync(mktTokenContract.address, taker)
    );

    if (takerMktBalance.isLessThan(signedOrder.takerFee)) {
      return Promise.reject(new Error(MarketError.InsufficientBalanceForTransfer));
    }

    const takersMktAllowance = new BigNumber(
      await erc20ContractWrapper.getAllowanceAsync(
        mktTokenContract.address,
        taker,
        signedOrder.feeRecipient
      )
    );

    if (takersMktAllowance.isLessThan(signedOrder.takerFee)) {
      return Promise.reject(new Error(MarketError.InsufficientAllowanceForTransfer));
    }

    const makerCollateralBalance: BigNumber = new BigNumber(
      await this.getUserAccountBalanceAsync(
        signedOrder.contractAddress,
        maker
      )
    );
    const takerCollateralBalance: BigNumber = new BigNumber(
      await this.getUserAccountBalanceAsync(
        signedOrder.contractAddress,
        taker
      )
    );

    const neededCollateralMaker: BigNumber = await this.calculateNeededCollateralAsync(
      signedOrder.contractAddress,
      fillQty,
      signedOrder.price
    );

    const neededCollateralTaker: BigNumber = await this.calculateNeededCollateralAsync(
      signedOrder.contractAddress,
      fillQty.times(-1), // opposite direction of the order sign! If i fill a buy order, I am selling / short.
      signedOrder.price
    );

    if (makerCollateralBalance.isLessThan(neededCollateralMaker)) {
      return Promise.reject(new Error(MarketError.InsufficientCollateralBalance));
    }

    if (takerCollateralBalance.isLessThan(neededCollateralTaker)) {
      return Promise.reject(new Error(MarketError.InsufficientCollateralBalance));
    }

    const txHash: string = await contractSetWrapper.marketContract
      .tradeOrderTx(
        // orderAddresses
        [signedOrder.maker, signedOrder.taker, signedOrder.feeRecipient],
        // unsignedOrderValues
        [
          signedOrder.makerFee,
          signedOrder.takerFee,
          signedOrder.price,
          signedOrder.expirationTimestamp,
          signedOrder.salt
        ],
        signedOrder.orderQty,
        fillQty,
        signedOrder.ecSignature.v,
        signedOrder.ecSignature.r,
        signedOrder.ecSignature.s
      )
      .send(txParams);

    const blockNumber: number = Number(this._web3.eth.getTransaction(txHash).blockNumber);

    return Promise.resolve(
      new OrderTransactionInfo(contractSetWrapper.marketContract, signedOrder, txHash, blockNumber)
    );
  }

  /**
   * Returns the qty that is no longer available to trade for a given order/
   * @param   marketContractAddress   The address of the Market contract.
   * @param   orderHash               Hash of order to find filled and cancelled qty.
   * @returns {Promise<BigNumber>}    A BigNumber of the filled or cancelled quantity.
   */
  public async getQtyFilledOrCancelledFromOrderAsync(
    marketContractAddress: string,
    orderHash: string
  ): Promise<BigNumber> {
    const contractSetWrapper: MarketProtocolContractSetWrapper = await this._getContractSetByMarketContractAddressAsync(
      marketContractAddress
    );
    return contractSetWrapper.marketContract.getQtyFilledOrCancelledFromOrder(orderHash);
  }

  /**
   * Gets the collateral pool contract address
   * @param {string} marketContractAddress    Address of the Market contract.
   * @returns {Promise<string>}               The contract's name
   */
  public async getMarketContractNameAsync(marketContractAddress: string): Promise<string> {
    const contractSetWrapper: MarketProtocolContractSetWrapper = await this._getContractSetByMarketContractAddressAsync(
      marketContractAddress
    );
    return contractSetWrapper.marketContract.CONTRACT_NAME;
  }

  /**
   * Gets the market contract price decimal places
   * @param {string} marketContractAddress    Address of the Market contract
   * @returns {Promise<BigNumber>}            The contract's price decimal places
   */
  public async getMarketContractPriceDecimalPlacesAsync(
    marketContractAddress: string
  ): Promise<BigNumber> {
    const contractSetWrapper: MarketProtocolContractSetWrapper = await this._getContractSetByMarketContractAddressAsync(
      marketContractAddress
    );
    return contractSetWrapper.marketContract.PRICE_DECIMAL_PLACES;
  }

  /**
   * Gets the contract name
   * @param {string} marketContractAddress    Address of the Market contract.
   * @returns {Promise<string>}               The collateral pool contract address.
   */
  public async getCollateralPoolContractAddressAsync(
    marketContractAddress: string
  ): Promise<string> {
    const contractSetWrapper: MarketProtocolContractSetWrapper = await this._getContractSetByMarketContractAddressAsync(
      marketContractAddress
    );
    return contractSetWrapper.marketContract.MARKET_COLLATERAL_POOL_ADDRESS;
  }

  /**
   * Calculates the required collateral amount in base units of a token.  This amount represents
   * a trader's maximum loss and therefore the amount of collateral that becomes locked into
   * the smart contracts upon execution of a trade.
   * @param {string} marketContractAddress
   * @param {BigNumber} qty             desired qty to trade (+ for buy / - for sell)
   * @param {BigNumber} price           execution price
   * @return {Promise<BigNumber>}       amount of needed collateral to become locked.
   */
  public async calculateNeededCollateralAsync(
    marketContractAddress: string,
    qty: BigNumber,
    price: BigNumber
  ): Promise<BigNumber> {
    const contractSetWrapper: MarketProtocolContractSetWrapper = await this._getContractSetByMarketContractAddressAsync(
      marketContractAddress
    );

    return Utils.calculateNeededCollateral(
      await contractSetWrapper.marketContract.PRICE_FLOOR,
      await contractSetWrapper.marketContract.PRICE_CAP,
      await contractSetWrapper.marketContract.QTY_MULTIPLIER,
      qty,
      price
    );
  }

  /**
   * deposits collateral to a traders account for a given contract address.
   * @param {string} marketContractAddress            Address of the MarketContract
   * @param {BigNumber | number} depositAmount        amount of ERC20 collateral to deposit
   * @param {ITxParams} txParams                      transaction parameters
   * @returns {Promise<string>}                       The transaction hash
   */
  public async depositCollateralAsync(
    marketContractAddress: string,
    depositAmount: BigNumber | number,
    txParams: ITxParams = {}
  ): Promise<string> {

    const contractSetWrapper: MarketProtocolContractSetWrapper = await this._getContractSetByMarketContractAddressAsync(
      marketContractAddress
    );

    // Ensure caller is enabled for contract
    const caller: string = String(txParams.from);
    const isUserEnabled = await this._market.mktTokenContract.isUserEnabledForContract(
      marketContractAddress,
      caller
    );

    if (!isUserEnabled) {
      return Promise.reject(new Error(MarketError.UserNotEnabledForContract));
    }

    // Ensure caller has sufficient collateral token balance
    const callerCollateralTokenBalance: BigNumber = new BigNumber(
      await this._erc20TokenContractWrapper.getBalanceAsync(contractSetWrapper.collateralToken.address, caller));

    if (callerCollateralTokenBalance.isLessThan(depositAmount)) {
      return Promise.reject(new Error(MarketError.InsufficientBalanceForTransfer));
    }

    // Ensure caller has approved sufficient amount
    const callerAllowance: BigNumber = new BigNumber(
      await this._erc20TokenContractWrapper.getAllowanceAsync(
      contractSetWrapper.collateralToken.address,
      caller,
      contractSetWrapper.marketCollateralPool.address
    )
  );
    if (callerAllowance.isLessThan(depositAmount)) {
      return Promise.reject(new Error(MarketError.InsufficientAllowanceForTransfer));
    }

    return contractSetWrapper.marketCollateralPool.depositTokensForTradingTx(depositAmount).send(txParams);
  }

  /**
   * Gets the user's currently unallocated token balance
   * @param {string} marketContractAddress       address of the MarketContract
   * @param {BigNumber | string} userAddress     address of user
   * @returns {Promise<BigNumber>}               the user's currently unallocated token balance
   */
  public async getUserAccountBalanceAsync(
    marketContractAddress: string,
    userAddress: string
  ): Promise<BigNumber> {
    const contractSetWrapper: MarketProtocolContractSetWrapper = await this._getContractSetByMarketContractAddressAsync(
      marketContractAddress
    );
    return contractSetWrapper.marketCollateralPool.getUserAccountBalance(userAddress);
  }

  /**
   * withdraws collateral from a traders account back to their own address.
   * @param {string} marketContractAddress       address of the MarketContract
   * @param {BigNumber | number} withdrawAmount        amount of ERC20 collateral to withdraw
   * @param {ITxParams} txParams                      transaction parameters
   * @returns {Promise<string>}                       The transaction hash.
   */
  public async withdrawCollateralAsync(
    marketContractAddress: string,
    withdrawAmount: BigNumber | number,
    txParams: ITxParams = {}
  ): Promise<string> {
    const contractSetWrapper: MarketProtocolContractSetWrapper = await this._getContractSetByMarketContractAddressAsync(
      marketContractAddress
    );

    // Ensure caller has sufficient collateral pool balance
    const caller: string = String(txParams.from);
    const balance = new BigNumber(await contractSetWrapper.marketCollateralPool.getUserAccountBalance(caller));
    if (balance.isLessThan(withdrawAmount)) {
      return Promise.reject(new Error(MarketError.InsufficientBalanceForTransfer));
    }
    return contractSetWrapper.marketCollateralPool.withdrawTokensTx(withdrawAmount).send(txParams);
  }


  /**
   * close all open positions post settlement and withdraws all collateral from a expired contract
   * @param {string} marketContractAddress       address of the MarketContract
   * @param {ITxParams} txParams                      transaction parameters
   * @returns {Promise<string>}                       The transaction hash
   */
  public async settleAndCloseAsync(
    marketContractAddress: string,
    txParams: ITxParams = {}
  ): Promise<string> {
    const contractSetWrapper: MarketProtocolContractSetWrapper = await this._getContractSetByMarketContractAddressAsync(
      marketContractAddress
    );
    return contractSetWrapper.marketCollateralPool.settleAndCloseTx().send(txParams);
  }


  /**
   * Gets the history of deposits and withdrawals for a given collateral pool address.
   * @param {string} marketContractAddress       address of the MarketContract
   * @param {string} fromBlock                        from block #
   * @param {string} toBlock                          to block #
   * @param {string} userAddress                      only search for deposits/withdrawals to/from a specified address
   * @returns {Promise<CollateralEvent[]>}
   */
  public async getCollateralEventsAsync(
    marketContractAddress: string,
    fromBlock: number|string = '0x0',
    toBlock: number|string = 'latest',
    userAddress: string|null = null,
  ): Promise<CollateralEvent[]> {
    const contractSetWrapper: MarketProtocolContractSetWrapper = await this._getContractSetByMarketContractAddressAsync(
      marketContractAddress
    );

    let collateralEvents: CollateralEvent[] = [];

    const logs = await contractSetWrapper.marketCollateralPool.UpdatedUserBalanceEvent({}).get({
      fromBlock: fromBlock,
      toBlock: toBlock
    });
    for (let e of logs) {
      const transaction = await new Promise<Transaction>((resolve, reject) => {
        this._web3.eth.getTransaction(e.transactionHash, (err: Error, tx: Transaction) => {
          if (err) {
            reject(err);
          }
          resolve(tx);
        });
      });
      const decoder = new Decoder.default(contractSetWrapper.marketCollateralPool.contractAbi);
      const input = decoder.decodeData(transaction.input);
      const event: CollateralEvent = {
        type: input.name === 'depositTokensForTrading' ? 'deposit' : 'withdrawal',
        from: input.name === 'depositTokensForTrading' ? transaction.from : transaction.to,
        to: input.name === 'depositTokensForTrading' ? transaction.to : transaction.from,
        amount: input.inputs[0],
        blockNumber: transaction.blockNumber,
        txHash: transaction.hash
      };
      if (!userAddress) {
        collateralEvents.push(event);
      }
      if ((userAddress === transaction.from) || (userAddress === transaction.to)) {
        collateralEvents.push(event);
      }
    }
    return collateralEvents;
  }



  // endregion //Public Methods

  // region Protected Methods
  // *****************************************************************
  // ****                    Protected Methods                    ****
  // *****************************************************************
  /**
   * Allow for retrieval or creation of a given MarketProtocolContractSetWrapper
   * @param {string} marketContractAddress                address of MarketContract
   * @returns {Promise<MarketProtocolContractSetWrapper>} MarketProtocolContractSetWrapper object
   * @private
   */
  protected async _getContractSetByMarketContractAddressAsync(
    marketContractAddress: string
  ): Promise<MarketProtocolContractSetWrapper> {
    const normalizedMarketAddress = marketContractAddress.toLowerCase();
    let contractSetWrapper: MarketProtocolContractSetWrapper = this
      ._marketProtocolSetByMarketContractAddress[normalizedMarketAddress];

    if (!_.isUndefined(contractSetWrapper)) {
      return contractSetWrapper;
    }

    contractSetWrapper = await this.createNewMarketContractSetFromMarketContractAddressAsync(
      marketContractAddress
    );
    this._marketProtocolSetByMarketContractAddress[normalizedMarketAddress] = contractSetWrapper;
    this._marketProtocolSetByMarketCollateralPoolAddress[
      contractSetWrapper.marketCollateralPool.address
    ] = contractSetWrapper;
    return contractSetWrapper;
  }

  /**
   * Creates a new contract set from a MarketContract address
   * @param {string} marketContractAddress
   * @returns {Promise<MarketProtocolContractSetWrapper>}
   */
  protected async createNewMarketContractSetFromMarketContractAddressAsync(
    marketContractAddress: string
  ): Promise<MarketProtocolContractSetWrapper> {
    const marketContract: MarketContract = new MarketContract(this._web3, marketContractAddress);
    const marketCollateralPool: MarketCollateralPool = new MarketCollateralPool(
      this._web3,
      await marketContract.MARKET_COLLATERAL_POOL_ADDRESS
    );
    const erc20: ERC20 = await this._erc20TokenContractWrapper.getERC20TokenContractAsync(
      await marketContract.COLLATERAL_TOKEN_ADDRESS
    );

    return new MarketProtocolContractSetWrapper(marketContract, marketCollateralPool, erc20);
  }

  // endregion //Protected Methods

  // region Private Methods
  // *****************************************************************
  // ****                     Private Methods                     ****
  // *****************************************************************
  // endregion //Private Methods
}
