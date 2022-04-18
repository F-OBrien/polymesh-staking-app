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
      <Link href='/overview-charts'>
        <a>Overview Charts</a>
      </Link>
      <Link href='/operator-charts'>
        <a>Operator Charts</a>
      </Link>
    </nav>
  );
};

export default Navbar;
