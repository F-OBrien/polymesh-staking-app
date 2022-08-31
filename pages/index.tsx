import type { NextPage } from 'next';
import Head from 'next/head';
import Image from 'next/image';

const Home: NextPage = () => {
  return (
    <>
      <Head>
        <title>Polymesh Staking Charts</title>
        <meta name='description' content='Generated by create next app' />
        <link rel='icon' href='/favicon.ico' />
      </Head>

      <div>
        <h1> Homepage</h1>
        <div style={{ textAlign: 'center', fontSize: '25px' }}>
          This is the home page. Not much to see here. <br />
          {`If you're here it's because you love`} <br />
          <Image src='/Polymesh-logo.svg' alt='Polymesh' width={500} height={100} />
          <br />
          Click the above links to see staking related charts
        </div>
      </div>
    </>
  );
};

export default Home;
