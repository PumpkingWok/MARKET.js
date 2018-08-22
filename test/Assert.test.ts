import BigNumber from 'bignumber.js';
// @ts-ignore
import FakeProvider from 'web3-fake-provider';
import Web3 from 'web3';

import { assert } from '../src/assert';
import { schemas } from '../src/schemas';

describe('Assert library', () => {
  const variableName = 'variable';

  describe('isString', () => {
    it('should not throw for valid input', () => {
      const validInputs = ['hello', 'goodbye'];
      validInputs.forEach(input =>
        expect(assert.isString.bind(assert, variableName, input)).not.toThrow()
      );
    });

    it('should throw for invalid input', () => {
      const invalidInputs = [42, false, { random: 'test' }, undefined, new BigNumber(45)];
      invalidInputs.forEach(input =>
        expect(assert.isString.bind(assert, variableName, input)).toThrow()
      );
    });
  });

  describe('isFunction', () => {
    it('should not throw for valid input', () => {
      const validInputs = [BigNumber, assert.isString];
      validInputs.forEach(input =>
        expect(assert.isFunction.bind(assert, variableName, input)).not.toThrow()
      );
    });

    it('should throw for invalid input', () => {
      const invalidInputs = [42, false, { random: 'test' }, undefined, new BigNumber(45)];
      invalidInputs.forEach(input =>
        expect(assert.isFunction.bind(assert, variableName, input)).toThrow()
      );
    });
  });

  describe('isNumber', () => {
    it('should not throw for valid input', () => {
      const validInputs = [42, 0, 21e42];
      validInputs.forEach(input =>
        expect(assert.isNumber.bind(assert, variableName, input)).not.toThrow()
      );
    });

    it('should throw for invalid input', () => {
      const invalidInputs = [false, { random: 'test' }, undefined, new BigNumber(45)];
      invalidInputs.forEach(input =>
        expect(assert.isNumber.bind(assert, variableName, input)).toThrow()
      );
    });
  });

  describe('isBoolean', () => {
    it('should not throw for valid input', () => {
      const validInputs = [true, false];
      validInputs.forEach(input =>
        expect(assert.isBoolean.bind(assert, variableName, input)).not.toThrow()
      );
    });

    it('should throw for invalid input', () => {
      const invalidInputs = [42, { random: 'test' }, undefined, new BigNumber(45)];
      invalidInputs.forEach(input =>
        expect(assert.isBoolean.bind(assert, variableName, input)).toThrow()
      );
    });
  });

  describe('assert', () => {
    const assertMessage = 'assert not satisfied';

    it('should not throw for valid input', () => {
      expect(assert.assert.bind(assert, true, assertMessage)).not.toThrow();
    });

    it('should throw for invalid input', () => {
      expect(assert.assert.bind(assert, false, assertMessage)).toThrow();
    });
  });

  describe('typeAssertionMessage', () => {
    it('should render correct message', () => {
      expect(assert.typeAssertionMessage('variable', 'string', 'number')).toEqual(
        `Expected variable to be of type string, encountered: number`
      );
    });
  });

  describe('isWeb3Provider', () => {
    it('should not throw for valid input', () => {
      const validInputs = [{ sendAsync: () => 45 }];
      validInputs.forEach(input =>
        expect(assert.isWeb3Provider.bind(assert, variableName, input)).not.toThrow()
      );
    });

    it('should throw for invalid input', () => {
      const invalidInputs = [42, { random: 'test' }, undefined, new BigNumber(45)];
      invalidInputs.forEach(input =>
        expect(assert.isWeb3Provider.bind(assert, variableName, input)).toThrow()
      );
    });
  });

  describe('isETHAddressHex', () => {
    it('should not throw for valid eth address', () => {
      const validAddress = '0xc1912fee45d61c87cc5ea59dae31190fffff232d';
      expect(assert.isETHAddressHex.bind(assert, variableName, validAddress)).not.toThrow();
    });

    it('should throw for invalid eth address', () => {
      const invalidAddresses = ['', '123ae', '0xcccccc'];
      invalidAddresses.forEach(invalidAddress => {
        expect(assert.isETHAddressHex.bind(assert, variableName, invalidAddress)).toThrow();
      });
    });
  });

  describe('isValidBaseUnitAmount', () => {
    it('should throw for negative amount', () => {
      const negativeAmount = new BigNumber(-45);
      expect(assert.isValidBaseUnitAmount.bind(assert, variableName, negativeAmount)).toThrow();
    });

    it('should throw for decimal amounts', () => {
      const decimalAmount = new BigNumber(23.45);
      expect(assert.isValidBaseUnitAmount.bind(assert, variableName, decimalAmount)).toThrow();
    });

    it('should not throw for non-negative non-decimal amounts', () => {
      const validAmount = new BigNumber(35);
      expect(assert.isValidBaseUnitAmount.bind(assert, variableName, validAmount)).not.toThrow();
    });

    it('should not throw for zero amounts', () => {
      const zeroAmount = new BigNumber(0);
      expect(assert.isValidBaseUnitAmount.bind(assert, variableName, zeroAmount)).not.toThrow();
    });
  });

  describe('isSenderAddressAsync', () => {
    it('should not throw for existing sender address', async () => {
      const senderAddress = '0xc1912fee45d61c87cc5ea59dae31190fffff232d';
      const mockProvider = new FakeProvider();
      mockProvider.injectResult([senderAddress]);

      await expect(
        assert.isSenderAddressAsync(variableName, senderAddress, new Web3(mockProvider))
      ).resolves.toBe(undefined);
    });

    it('should throw for non existing sender address', async () => {
      const senderAddress = '0xc1912fee45d61c87cc5ea59dae31190fffff232d';
      const existingAddresses = ['0xc234567845d61c87cc5ea59dae31190abcdef23a'];
      const mockProvider = new FakeProvider();
      mockProvider.injectResult(existingAddresses);

      await expect(
        assert.isSenderAddressAsync(variableName, senderAddress, new Web3(mockProvider))
      ).rejects.toThrow();
    });
  });

  describe('isSchemaValid', () => {
    it.each([
      ['validETHAddress', '0xc1912fee45d61c87cc5ea59dae31190fffff232d', schemas.AddressSchema],
      ['validNumber', '1234', schemas.NumberSchema],
      ['validFloatNumber', '123.45', schemas.NumberSchema],
      ['validNumberWithExponent', '1.23e-5', schemas.NumberSchema],
      ['validNumberWithSign', '-25', schemas.NumberSchema],
      ['validNumberWithSignAndExponent', '-45.34e+20', schemas.NumberSchema]
    ])('should not throw for %s', (name, value, schema) => {
      const validETHAddress = '0xc1912fee45d61c87cc5ea59dae31190fffff232d';
      expect(() => {
        assert.isSchemaValid(name, value, schema);
      }).not.toThrow();
    });

    it('should throw for invalid schema', () => {
      const invalidETHAddress = '0x';
      expect(() => {
        assert.isSchemaValid('invalidETHAddress', invalidETHAddress, schemas.AddressSchema);
      }).toThrow();
    });
  });
});
