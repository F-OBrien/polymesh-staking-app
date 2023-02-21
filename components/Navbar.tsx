import Link from 'next/link';
import { ReactElement } from 'react';
import styles from '../styles/Home.module.css';

export const Navbar = (): ReactElement => {
  return (
    <nav>
      <div className='logo'>
        <h1> Polymesh Staking Charts</h1>
      </div>
      <Link href='/' className={styles.btn}>
        Home
      </Link>
      <Link href='/overview-charts' className={styles.btn}>
        Overview
      </Link>
      <Link href='/operator-charts' className={styles.btn}>
        History
      </Link>
      <Link href='/operator-trends' className={styles.btn}>
        Trends
      </Link>
      <Link href='/operator-info' className={styles.btn}>
        Current Info
      </Link>
    </nav>
  );
};

export default Navbar;
