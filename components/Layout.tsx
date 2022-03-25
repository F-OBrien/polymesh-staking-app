import Fotter from './Fotter';
import Navbar from './Navbar';

type LayoutProps = {
  children: React.ReactElement;
};

const Layout = ({ children }: LayoutProps) => {
  return (
    <div className='content'>
      <Navbar />
      {children}
      <Fotter />
    </div>
  );
};

export default Layout;
