import { Artifact } from '@marketprotocol/types';
import { AbiDefinition, EventAbi, MethodAbi } from '../types';

/**
 * Result of ABI Verification of a contract at an address
 */
export interface ValidVerification {
  isValid: true;
  name: string;
}

export interface InvalidVerification {
  isValid: false;
  name: string;
  error: string;
}

export type ABIVerificationResult = ValidVerification | InvalidVerification;

export interface ArtifactTypeChainPair {
  artifact: Artifact;
  contract: object;
}

interface DynamicCheckableObject {
  [field: string]: {
    length: number | undefined;
  };
}

/**
 * Utility class to compare contracts abis and and their generated typechain classes
 *
 */
export class ContractABIVerifier {
  // region Members
  // *****************************************************************
  // ****                     Members                             ****
  // *****************************************************************

  // endregion // members
  // region Constructors
  // *****************************************************************
  // ****                     Constructors                        ****
  // *****************************************************************
  // endregion//Constructors
  // region Properties
  // *****************************************************************
  // ****                     Properties                          ****
  // *****************************************************************
  // endregion //Properties
  // region Public Methods
  // *****************************************************************
  // ****                     Public Methods                      ****
  // *****************************************************************

  /**
   * Verifies that the artifact corresponds to the typechain pair
   *
   *
   * @param pairs
   * @param address
   * @return ABIVerificationResult
   */
  public verify(pairs: ArtifactTypeChainPair[]): ABIVerificationResult[] {
    return pairs.map(pair => this._verifyPair(pair));
  }
  // endregion //Public Methods
  // region Private Methods
  // *****************************************************************
  // ****                     Private Methods                     ****
  // *****************************************************************
  // endregion //Private Methods
  private _verifyPair(pair: ArtifactTypeChainPair): ABIVerificationResult {
    try {
      for (const abiParams of pair.artifact.abi as AbiDefinition[]) {
        switch (abiParams.type) {
          case 'function':
            this._validFunction(abiParams, pair.contract);
            break;
          case 'event':
            this._validEvent(abiParams, pair.contract);
            break;
          default:
          // noop
        }
      }

      return {
        isValid: true,
        // TODO: Rename this to contractName when Artifact type is updated
        // currently returning undefined
        name: pair.artifact.contract_name
      };
    } catch (err) {
      return {
        isValid: false,
        name: pair.artifact.contract_name,
        error: err.message
      };
    }
  }

  /**
   * Check to ensure the abi function is defined on the contract and it has
   * the same number of inputs as in the abi
   *
   * @param {MethodAbi} abiItem
   * @param {object} contract TypeChain Contract
   */
  private _validFunction(abiItem: MethodAbi, contract: object) {
    let fnName = abiItem.name;
    if (!abiItem.constant) {
      fnName = fnName + 'Tx';
    }

    if (typeof (contract as DynamicCheckableObject)[fnName] === 'undefined') {
      throw new Error(`abi function [${abiItem.name}] does not exist on contract as ${fnName}`);
    }

    const abiInputLength = abiItem.inputs.length;

    const contractFnInputLength = (contract as DynamicCheckableObject)[fnName].length;
    if (abiInputLength === 0 && typeof contractFnInputLength !== 'undefined') {
      throw new Error(`abi function [${abiItem.name}] argument mismatch`);
    }

    if (abiInputLength !== 0 && contractFnInputLength !== abiInputLength) {
      throw new Error(`abi function [${abiItem.name}] argument mismatch`);
    }
  }

  /**
   * Check to ensure the event is defined on the contract.
   *
   * @param {EventAbi} abiItem
   * @param {object} contract
   */
  private _validEvent(abiItem: EventAbi, contract: object) {
    let eventName = abiItem.name + 'Event';

    if (typeof (contract as DynamicCheckableObject)[eventName] === 'undefined') {
      throw new Error(`abi event ${abiItem.name} does not exist on contract as ${eventName}`);
    }
  }

  // region Event Handlers
  // *****************************************************************
  // ****                     Event Handlers                     ****
  // *****************************************************************
  // endregion //Event Handlers
}
