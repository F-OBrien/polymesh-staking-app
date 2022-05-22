import '../styles/globals.css';
import type { AppProps } from 'next/app';
import Layout from '../components/Layout';
import SdkAppWrapper from '../context/SdkContext';
import { QueryClient, QueryClientProvider } from 'react-query';
// import { ReactQueryDevtools } from 'react-query/devtools';
import StakingContextAppWrapper from '../context/StakingContext';

// define a new react-query client for caching across pages
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      cacheTime: 21600000,
    },
  },
});

function MyApp({ Component, pageProps }: AppProps) {
  return (
    <QueryClientProvider client={queryClient}>
      <SdkAppWrapper>
        <StakingContextAppWrapper>
          <Layout>
            <>
              <Component {...pageProps} />
              {/* <ReactQueryDevtools initialIsOpen /> */}
            </>
          </Layout>
        </StakingContextAppWrapper>
      </SdkAppWrapper>
    </QueryClientProvider>
  );
}

export default MyApp;
