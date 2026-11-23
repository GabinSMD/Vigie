import { useEffect, useRef } from 'react';
import { HashRouter, Route, Routes, useLocation } from 'react-router-dom';
import { TabBar } from './components/TabBar';
import { Toast } from './components/Toast';
import { StoreProvider, pendingItems, useStore, type DemoState } from './data/store';
import { Accueil } from './screens/Accueil';
import { Bientot } from './screens/Bientot';
import { NotFound } from './screens/NotFound';
import { Projet } from './screens/Projet';
import { Projets } from './screens/Projets';
import { PullRequest } from './screens/PullRequest';
import { Session } from './screens/Session';

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Accueil />} />
      <Route path="/projets" element={<Projets />} />
      <Route path="/projets/:projectId" element={<Projet />} />
      <Route path="/projets/:projectId/:tab" element={<Projet />} />
      <Route path="/projets/:projectId/sessions/:sessionId" element={<Session />} />
      <Route path="/projets/:projectId/pr/:prNumber" element={<PullRequest />} />
      <Route path="/lancer" element={<Bientot title="Lancer du travail" />} />
      <Route path="/reglages" element={<Bientot title="Réglages" />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

/** Coquille : lien d'évitement, contenu, barre d'onglets. Le focus va au contenu à chaque navigation. */
export function Shell() {
  const { state } = useStore();
  const { pathname } = useLocation();
  const mainRef = useRef<HTMLElement>(null);
  const first = useRef(true);

  useEffect(() => {
    window.scrollTo?.(0, 0);
    if (first.current) {
      first.current = false;
      return;
    }
    mainRef.current?.focus();
  }, [pathname]);

  return (
    <div className="app">
      <a className="skip" href="#contenu" onClick={(e) => { e.preventDefault(); mainRef.current?.focus(); }}>
        Aller au contenu
      </a>
      <main id="contenu" ref={mainRef} className="main" tabIndex={-1}>
        <AppRoutes />
      </main>
      <TabBar todoCount={pendingItems(state).length} />
      <Toast />
    </div>
  );
}

export function App({ initialState }: { initialState?: DemoState }) {
  return (
    <StoreProvider initial={initialState}>
      <HashRouter>
        <Shell />
      </HashRouter>
    </StoreProvider>
  );
}
