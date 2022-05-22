import Link from 'next/link';
import { ReactElement } from 'react';
import styles from '../styles/Home.module.css';

export const Navbar = (): ReactElement => {
  return (
    <nav>
      <div className='logo'>
        <h1> Polymesh Staking Stats</h1>
      </div>
      <Link href='/'>
        <a className={styles.btn}>Home</a>
      </Link>
      <Link href='/overview-charts'>
        <a className={styles.btn}>Overview</a>
      </Link>
      <Link href='/operator-charts'>
        <a className={styles.btn}>Operator History</a>
      </Link>
      <Link href='/operator-info'>
        <a className={styles.btn}>Operator Info</a>
      </Link>
    </nav>
  );
};

export default Navbar;
