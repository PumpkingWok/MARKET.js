import BigNumber from 'bignumber.js';
import Web3 from 'web3';
// @ts-ignore // allow any type for web3-fake-provider.
import FakeProvider from 'web3-fake-provider';

// Types
import { ECSignature } from '@marketprotocol/types';
import { Utils } from '../src';
import { cat } from 'shelljs';

/**
 * Utils
 */
describe('Utils library', () => {
  const getStubedWeb3 = (rawSignature: string) => {
    const fakeProvider = new FakeProvider();
    const web3 = new Web3(fakeProvider);
    fakeProvider.injectResult(rawSignature);
    return web3;
  };

  it('signMessage should correctly extract ecSignature', () => {
    const rawSignature =
      '0x9955af11969a2d2a7f860cb00e6a00cfa7c581f5df2dbe8ea' +
      '16700b33f4b4b9b69f945012f7ea7d3febf11eb1b78e1adc2d1c14c2cf48b25000938cc1860c83e01';

    const web3 = getStubedWeb3(rawSignature);

    const v = 28;
    const r = '0x9955af11969a2d2a7f860cb00e6a00cfa7c581f5df2dbe8ea16700b33f4b4b9b';
    const s = '0x69f945012f7ea7d3febf11eb1b78e1adc2d1c14c2cf48b25000938cc1860c83e';

    Utils.signMessage(
      web3,
      '0xf204a4ef082f5c04bb89f7d5e6568b796096735a',
      'This is my message :)'
    ).then((ecSignature: ECSignature) => {
      expect(v).toBe(ecSignature.v);
      expect(r).toBe(ecSignature.r);
      expect(s).toBe(ecSignature.s);
    });
  });

  it('generates different salts', () => {
    expect(Utils.generatePseudoRandomSalt().eq(Utils.generatePseudoRandomSalt())).toBeFalsy();
  });

  it('generates salt in range [0..2^256)', () => {
    const salt = Utils.generatePseudoRandomSalt();
    expect(salt.isGreaterThanOrEqualTo(0)).toBeTruthy();
    const twoPow256 = new BigNumber(2).pow(256);
    expect(salt.isLessThan(twoPow256)).toBeTruthy();
  });

  it('parses a contract name correctly', () => {
    expect(Utils.parseStandardizedContractName('EXPECT_TO_FAIL')).toBeNull();
    expect(Utils.parseStandardizedContractName('EXPECT_TO_FAIL_NAN_FAIL')).toBeDefined();
    expect(Utils.parseStandardizedContractName('EXPECT_TO_FAIL_505_FAIL')).toBeDefined();

    const parsedName = Utils.parseStandardizedContractName('BTC_USDT_BIN_123_PE');
    expect(parsedName).toBeDefined();
    if (!parsedName) {
      return;
    }
    expect(parsedName.referenceAsset).toBe('BTC');
    expect(parsedName.collateralToken).toBe('USDT');
    expect(parsedName.dataProvider).toBe('BIN');
    expect(parsedName.expirationTimeStamp).toEqual(new BigNumber(123));
    expect(parsedName.userText).toBe('PE');
  });

  it('creates a contract name correctly', () => {
    const contractName: string = Utils.createStandardizedContractName(
      'BTC',
      'USDT',
      'BIN',
      new BigNumber(123),
      'PE'
    );
    expect(contractName).toEqual('BTC_USDT_BIN_123_PE');
  });

  it('returns a correct network id', async () => {
    let web3 = new Web3(new Web3.providers.HttpProvider('http://localhost:9545'));
    const networkID: string = await Utils.getNetworkId(web3);
    expect(networkID).toEqual('4447');
  });

  it('fails to return a network id when not connected to valid provider', async () => {
    let web3 = new Web3(new Web3.providers.HttpProvider('http://fake:9545'));
    try {
      await Utils.getNetworkId(web3);
    } catch (e) {
      expect(e).toBe('Unable to connect. Please check your PROVIDER or start truffle.');
    }
  });
});
