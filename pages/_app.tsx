import '../styles/globals.css';
import type { AppProps } from 'next/app';
import Layout from '../components/Layout';
import SdkAppWrapper from '../context/SdkContext';
import { QueryClient, QueryClientProvider } from 'react-query';
import { ReactQueryDevtools } from 'react-query/devtools';

// define a new react-query client for caching across pages
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      // staleTime: 2000,
    },
  },
});

function MyApp({ Component, pageProps }: AppProps) {
  return (
    <QueryClientProvider client={queryClient}>
      <SdkAppWrapper>
        <Layout>
          <>
            <Component {...pageProps} />
            <ReactQueryDevtools initialIsOpen />
          </>
        </Layout>
      </SdkAppWrapper>
    </QueryClientProvider>
  );
}

export default MyApp;
