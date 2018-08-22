import { ArtifactTypeChainPair, ContractABIVerifier } from '../src/utilities/ContractABIVerifier';
import { Helper } from './helper';
import { MARKETProtocolArtifacts } from '../src/MARKETProtocolArtifacts';

describe('ContractABIVerifier', () => {
  let helper: Helper;
  let verifier: ContractABIVerifier;
  let artifacts: MARKETProtocolArtifacts;

  beforeEach(async () => {
    verifier = new ContractABIVerifier();
    helper = new Helper();
    artifacts = new MARKETProtocolArtifacts(helper.market.config.networkId);
  });

  it('should fail for incorrect abi typechain pair ', () => {
    const pair: ArtifactTypeChainPair = {
      contract: helper.market.mktTokenContract,
      artifact: artifacts.marketCollateralPoolFactoryArtifact
    };
    const result = verifier.verify([pair]);
    expect(result[0].isValid).toEqual(false);
  });

  it('should pass for correct abi typechain pair ', () => {
    const pair: ArtifactTypeChainPair = {
      contract: helper.market.mktTokenContract,
      artifact: artifacts.marketTokenArtifact
    };
    const result = verifier.verify([pair]);
    expect(result[0].isValid).toEqual(true);
  });
});
