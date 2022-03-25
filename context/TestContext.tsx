import { createContext, useContext, useMemo } from 'react';

export interface TestContextInterface {
  data?: string;
}

export const TestContext = createContext<TestContextInterface>({});

export const TestContextProvider = TestContext.Provider;
export const TestContextConsumer = TestContext.Consumer;

type TestContextProps = {
  children: React.ReactNode | React.ReactElement;
};

interface Props {
  children: React.ReactNode;
}

export function useTestContext() {
  return useContext(TestContext);
}
let testData: string;
function GetDataWrapper({ children }: Props): React.ReactElement<Props> | null {
  const data = useMemo(() => {
    testData = 'Test Data again32';
    return testData;
  }, []);

  if (testData === 'Test Data again') {
    return <div>hello this is a test</div>;
  }
  return <TestContext.Provider value={{ data }}>hello{children}</TestContext.Provider>;
  // return <TestContext.Provider value={{ data }}>...</TestContext.Provider>;
}

export default GetDataWrapper;
