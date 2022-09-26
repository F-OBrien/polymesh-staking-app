import '../styles/globals.css';
import type { AppProps } from 'next/app';
import Layout from '../components/Layout';
import SdkAppWrapper from '../context/SdkContext';
import { QueryClient, QueryClientProvider } from 'react-query';
// import { ReactQueryDevtools } from 'react-query/devtools';
import StakingContextAppWrapper from '../context/StakingContext';

import { Chart, Title } from 'chart.js';
import { chartAreaBorder } from '../components/charts/chartPlugins/chartAreaBorderPlugin';
import { useEffect } from 'react';

Chart.register(Title, chartAreaBorder);

Chart.defaults.font.family = 'Poppins';
Chart.defaults.scale.grid.drawOnChartArea = false;
Chart.defaults.scale.grid.drawBorder = false;

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
  // Set chart default font sizes based on window size
  useEffect(() => {
    function handleWindowResize() {
      if (window.innerWidth > 1600) {
        Chart.defaults.font.size = 15;
        Chart.defaults.plugins.title.font = { weight: 'normal', size: 18 };
        return;
      }
      if (window.innerWidth > 1500) {
        Chart.defaults.font.size = 14;
        Chart.defaults.plugins.title.font = { weight: 'normal', size: 17 };
        return;
      }
      if (window.innerWidth > 1400) {
        Chart.defaults.font.size = 13;
        Chart.defaults.plugins.title.font = { weight: 'normal', size: 16 };
        return;
      }
      if (window.innerWidth > 1300) {
        Chart.defaults.font.size = 12;
        Chart.defaults.plugins.title.font = { weight: 'normal', size: 15 };
        return;
      }
      if (window.innerWidth > 1225) {
        Chart.defaults.font.size = 11;
        Chart.defaults.plugins.title.font = { weight: 'normal', size: 14 };
        return;
      }
      if (window.innerWidth > 1140) {
        Chart.defaults.font.size = 10;
        Chart.defaults.plugins.title.font = { weight: 'normal', size: 13 };
        return;
      }
      if (window.innerWidth > 1060) {
        Chart.defaults.font.size = 9;
        Chart.defaults.plugins.title.font = { weight: 'normal', size: 12 };
        return;
      }
      Chart.defaults.font.size = 8;
      Chart.defaults.plugins.title.font = { weight: 'normal', size: 11 };
    }
    handleWindowResize();
    window.addEventListener('resize', handleWindowResize);

    return () => {
      window.removeEventListener('resize', handleWindowResize);
    };
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <Layout>
        <SdkAppWrapper>
          <StakingContextAppWrapper>
            <>
              <Component {...pageProps} />
              {/* <ReactQueryDevtools initialIsOpen /> */}
            </>
          </StakingContextAppWrapper>
        </SdkAppWrapper>
      </Layout>
    </QueryClientProvider>
  );
}

export default MyApp;
