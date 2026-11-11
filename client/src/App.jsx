import { AnimatePresence, MotionConfig, motion } from 'framer-motion';
import { useEffect } from 'react';
import { Route, Routes, useLocation } from 'react-router-dom';
import Ambient from './components/Ambient.jsx';
import Footer from './components/Footer.jsx';
import Nav from './components/Nav.jsx';
import { FormatsProvider } from './lib/FormatsContext.jsx';
import Formats from './pages/Formats.jsx';
import Home from './pages/Home.jsx';
import NotFound from './pages/NotFound.jsx';
import Privacy from './pages/Privacy.jsx';
import ToolPage from './pages/ToolPage.jsx';
import ToolsIndex from './pages/ToolsIndex.jsx';

function Page({ children }) {
  return (
    <motion.main
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.main>
  );
}

export default function App() {
  const location = useLocation();
  useEffect(() => {
    if (!location.hash) window.scrollTo({ top: 0, behavior: 'instant' });
  }, [location.pathname, location.hash]);

  return (
    <MotionConfig reducedMotion="user">
      <FormatsProvider>
        <Ambient />
        <Nav />
        <AnimatePresence mode="wait">
          <Routes location={location} key={location.pathname}>
            <Route path="/" element={<Page><Home /></Page>} />
            <Route path="/tools" element={<Page><ToolsIndex /></Page>} />
            <Route path="/tools/:slug" element={<Page><ToolPage /></Page>} />
            <Route path="/formats" element={<Page><Formats /></Page>} />
            <Route path="/privacy" element={<Page><Privacy /></Page>} />
            <Route path="*" element={<Page><NotFound /></Page>} />
          </Routes>
        </AnimatePresence>
        <Footer />
      </FormatsProvider>
    </MotionConfig>
  );
}
