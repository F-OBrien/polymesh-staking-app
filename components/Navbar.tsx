import Link from 'next/link';
import { ReactElement } from 'react';

export const Navbar = (): ReactElement => {
  return (
    <nav>
      <div className='logo'>
        <h1> Polymesh Staking Stats</h1>
      </div>
      <Link href='/'>
        <a>Home</a>
      </Link>
      <Link href='/stakingCharts'>
        <a>Staking Charts</a>
      </Link>
      <Link href='/page2'>
        <a>Page 2</a>
      </Link>
      <Link href='/page3'>
        <a>Page 3</a>
      </Link>
    </nav>
  );
};

export default Navbar;
