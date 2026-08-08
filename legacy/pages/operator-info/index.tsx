import { OperatorsTokensNominated, OperatorsTokensAssigned, OperatorsActiveEraPoints } from '../../components/chartsNoSSR';
import { EraIndex } from '@polkadot/types/interfaces';

export interface EraInfo {
  activeEra: EraIndex;
  currentEra: EraIndex;
  historyDepth: number;
}

function App() {
  return (
    <div className='App'>
      <>
        <OperatorsActiveEraPoints />
        <OperatorsTokensNominated />
        <OperatorsTokensAssigned />
      </>
    </div>
  );
}

export default App;
