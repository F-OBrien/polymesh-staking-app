import Footer from './Footer';
import Navbar from './Navbar';

type LayoutProps = {
  children: React.ReactElement;
};

const Layout = ({ children }: LayoutProps) => {
  return (
    <div className='content'>
      <Navbar />
      {children}
      <Footer />
    </div>
  );
};

export default Layout;
