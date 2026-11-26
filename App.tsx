import React, { Suspense, useEffect, useRef, useState } from 'react';
import { AppProvider, useAppStore } from './store';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { StoreProvider, useStore } from './contexts/StoreContext';
import { PushNotificationProvider } from './components/PushNotificationProvider';
import { AppView } from './types';
import { NoStore } from './pages/NoStore';
import { AccessExpired } from './pages/AccessExpired';
import { DialogHost } from './components/UI';
import { SubscriptionBanner } from './components/SubscriptionBanner';
import { Login } from './pages/Login';
import { NovoLogin } from './pages/NovoLogin';
import { ClientesArea } from './components/ClientesArea';
import { MODULES, MODULE_CATEGORIES, ModuleCategory, ROLE_LABELS } from './lib/modules';
import {
  LayoutDashboard,
  ArrowUpCircle,
  ArrowDownCircle,
  ShoppingCart,
  Package,
  Users,
  FileText,
  Truck,
  Settings,
  LogOut,
  Menu,
  FileSpreadsheet,
  ChevronDown,
  ChevronRight,
  UserCheck,
  Wrench,
  Moon,
  Sun,
  TrendingUp,
  X,
  CheckCircle,
  AlertCircle,
  Info,
  History,
  RefreshCcw,
  Smartphone,
  Store as StoreIcon,
  Boxes,
  Search,
} from 'lucide-react';

// Telas carregadas sob demanda (code-splitting): cada uma vira um arquivo próprio.
const lazyPage = <T extends Record<string, any>>(loader: () => Promise<T>, name: keyof T) =>
  React.lazy(() => loader().then(m => ({ default: m[name] as React.ComponentType<any> })));
const Dashboard = lazyPage(() => import('./pages/Dashboard'), 'Dashboard');
const AdminDashboard = lazyPage(() => import('./components/AdminDashboard'), 'AdminDashboard');
const Financial = lazyPage(() => import('./pages/Financial'), 'Financial');
const Inventory = lazyPage(() => import('./pages/Inventory'), 'Inventory');
const Sales = lazyPage(() => import('./pages/Sales'), 'Sales');
const Customers = lazyPage(() => import('./pages/Customers'), 'Customers');
const Production = lazyPage(() => import('./pages/Production'), 'Production');
const Deliveries = lazyPage(() => import('./pages/Deliveries'), 'Deliveries');
const Suppliers = lazyPage(() => import('./pages/Suppliers'), 'Suppliers');
const Reports = lazyPage(() => import('./pages/Reports'), 'Reports');
const SalesHistory = lazyPage(() => import('./pages/SalesHistory'), 'SalesHistory');
const Orders = lazyPage(() => import('./pages/Orders'), 'Orders');
const StockEntries = lazyPage(() => import('./pages/StockEntries'), 'StockEntries');
const Quotes = lazyPage(() => import('./pages/Quotes'), 'Quotes');
const StoreAdmin = lazyPage(() => import('./pages/StoreAdmin'), 'StoreAdmin');
const Team = lazyPage(() => import('./pages/Team'), 'Team');
const SettingsPage = lazyPage(() => import('./pages/Settings'), 'Settings');
const MobileApp = lazyPage(() => import('./components/mobile/MobileApp'), 'MobileApp');

const VIEW_ICONS: Partial<Record<AppView, React.ReactNode>> = {
  DASHBOARD: <LayoutDashboard size={20} />,
  REPORTS: <TrendingUp size={20} />,
  PAYABLES: <ArrowDownCircle size={20} />,
  RECEIVABLES: <ArrowUpCircle size={20} />,
  BOLETOS: <FileText size={20} />,
  SALES: <ShoppingCart size={20} />,
  SALES_HISTORY: <History size={20} />,
  QUOTES: <FileSpreadsheet size={20} />,
  CUSTOMERS: <UserCheck size={20} />,
  INVENTORY: <Package size={20} />,
  PRODUCTION: <Wrench size={20} />,
  SUPPLIERS: <Users size={20} />,
  ORDERS: <Boxes size={20} />,
  DELIVERIES: <Truck size={20} />,
  SETTINGS: <Settings size={20} />,
  STORE_ADMIN: <StoreIcon size={20} />,
  TEAM: <Users size={20} />,
};

const NotificationContainer = () => {
  const { notifications, removeNotification } = useAppStore();

  if (notifications.length === 0) return null;

  return (
    <div className="fixed top-4 sm:top-4 left-4 right-4 sm:left-auto sm:right-4 z-50 space-y-2 flex flex-col items-start sm:items-end pointer-events-none print:hidden max-w-xs sm:max-w-sm">
      {notifications.map(n => (
        <div
          key={n.id}
          className={`
            pointer-events-auto flex items-center gap-3 px-3 sm:px-4 py-2 sm:py-3 rounded-lg shadow-lg text-white transform transition-all duration-300 animate-slide-in-right text-sm sm:text-base
            ${n.type === 'success' ? 'bg-emerald-600' : n.type === 'error' ? 'bg-red-600' : 'bg-blue-600'}
          `}
        >
          {n.type === 'success' && <CheckCircle size={18} />}
          {n.type === 'error' && <AlertCircle size={18} />}
          {n.type === 'info' && <Info size={18} />}
          <span className="text-sm font-medium">{n.message}</span>
          <button onClick={() => removeNotification(n.id)} className="ml-2 hover:bg-white/20 p-1 rounded">
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
};

const LoadingScreen = ({ message }: { message: string }) => (
  <div className="h-screen w-full flex items-center justify-center bg-wine-50 dark:bg-slate-900">
    <div className="flex flex-col items-center gap-4">
      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-wine-700"></div>
      <p className="text-wine-800 dark:text-wine-100 font-medium animate-pulse">{message}</p>
    </div>
  </div>
);

const AppContent: React.FC = () => {
  const { currentView, navigateTo, darkMode, toggleDarkMode, companySettings, isInitialized, refreshData, addNotification } = useAppStore();
  const { user, loading, signOut } = useAuth();
  const {
    status: storeStatus,
    stores,
    activeStore,
    role,
    isPlatformAdmin,
    impersonatedStore,
    stopImpersonation,
    canAccessView,
    switchStore,
    subscription,
  } = useStore();
  const [isSidebarOpen, setSidebarOpen] = useState(true);

  const [expandedSections, setExpandedSections] = useState<Partial<Record<ModuleCategory, boolean>>>(() => {
    const cat = MODULES.find(m => m.views.some(v => v.view === currentView))?.category;
    return cat ? { [cat]: true } : { geral: true };
  });
  const [menuQuery, setMenuQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  // Abre a categoria da tela atual quando a navegação muda.
  useEffect(() => {
    const cat = MODULES.find(m => m.views.some(v => v.view === currentView))?.category;
    if (cat) setExpandedSections(prev => (prev[cat] ? prev : { ...prev, [cat]: true }));
  }, [currentView]);

  // Ctrl+K / Cmd+K: foca a busca do menu.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSidebarOpen(true);
        window.setTimeout(() => searchRef.current?.focus(), 50);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const [isMobileMode, setIsMobileMode] = useState(() => {
    const saved = localStorage.getItem('COM_STILLO_VIEW_MODE');
    if (saved === 'mobile') return true;
    if (saved === 'desktop') return false;
    return typeof window !== 'undefined' ? window.innerWidth < 768 : false;
  });

  const handleToggleMobileMode = (val: boolean) => {
    setIsMobileMode(val);
    localStorage.setItem('COM_STILLO_VIEW_MODE', val ? 'mobile' : 'desktop');
  };

  if (loading) return <LoadingScreen message="Carregando sistema..." />;
  if (!user) return window.location.hash === '#novo-login' ? <NovoLogin /> : <Login />;
  if (storeStatus === 'loading') return <LoadingScreen message="Carregando sua loja..." />;
  if (storeStatus === 'no_store') return <NoStore />;
  // Área de clientes nova (só admin da plataforma). O painel antigo continua em Clientes & Lojas.
  if (isPlatformAdmin && window.location.hash === '#area-clientes') return <ClientesArea />;
  if (subscription && !subscription.accessOk) return <AccessExpired />;
  if (!isInitialized) return <LoadingScreen message="Carregando dados da loja..." />;

  if (isMobileMode) {
    return (
      <>
        <SubscriptionBanner floating />
        <DialogHost />
        <Suspense fallback={<LoadingScreen message="Carregando versão mobile..." />}>
          <MobileApp onSwitchToDesktop={() => handleToggleMobileMode(false)} />
        </Suspense>
      </>
    );
  }

  const toggleSection = (section: ModuleCategory) => {
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  const handleNavigate = (view: AppView) => {
    if (canAccessView(view)) {
      navigateTo(view);
      if (window.innerWidth < 768) setSidebarOpen(false);
    } else {
      addNotification('Você não tem acesso a esta tela ou o módulo está desligado.', 'error');
    }
  };

  const handleSwitchStore = async (storeId: string) => {
    try {
      await switchStore(storeId);
      navigateTo('DASHBOARD');
      addNotification('Loja alterada.', 'success');
    } catch (err: any) {
      addNotification(err.message || 'Não foi possível trocar de loja.', 'error');
    }
  };

  // Primeira tela que o usuário pode abrir (para o botão "voltar").
  const firstAllowedView = MODULES.flatMap(m => m.views).find(v => canAccessView(v.view))?.view;

  const renderView = () => {
    if (!canAccessView(currentView)) {
      return (
        <div className="flex flex-col items-center justify-center h-full text-wine-800 dark:text-slate-300">
          <div className="bg-red-100 dark:bg-red-900/20 p-6 rounded-full mb-4">
            <LogOut size={48} className="text-red-500" />
          </div>
          <h2 className="text-2xl font-bold mb-2">Tela indisponível</h2>
          <p className="text-center max-w-md">
            Esta tela não está liberada para você, ou o módulo dela está desligado nesta loja.
            Fale com o dono ou gerente da loja.
          </p>
          {firstAllowedView && (
            <button
              onClick={() => navigateTo(firstAllowedView)}
              className="mt-6 px-6 py-2 bg-wine-900 text-white rounded-lg hover:bg-wine-800 transition-colors"
            >
              Voltar
            </button>
          )}
        </div>
      );
    }

    switch (currentView) {
      case 'DASHBOARD': return isPlatformAdmin && !impersonatedStore ? <AdminDashboard /> : <Dashboard />;
      case 'PAYABLES': return <Financial type="PAYABLES" />;
      case 'RECEIVABLES': return <Financial type="RECEIVABLES" />;
      case 'BOLETOS': return <Financial type="BOLETOS" />;
      case 'SALES': return <Sales />;
      case 'SALES_HISTORY': return <SalesHistory />;
      case 'INVENTORY': return <Inventory />;
      case 'CUSTOMERS': return <Customers />;
      case 'PRODUCTION': return <Production />;
      case 'DELIVERIES': return <Deliveries />;
      case 'SETTINGS': return <SettingsPage />;
      case 'STORE_ADMIN': return <StoreAdmin />;
      case 'TEAM': return <Team />;
      case 'SUPPLIERS': return <Suppliers />;
      case 'REPORTS': return <Reports />;
      case 'QUOTES': return <Quotes />;
      case 'ORDERS': return <Orders />;
      case 'STOCK_LOGS': return <StockEntries />;
      default: return <Dashboard />;
    }
  };

  const NavItem: React.FC<{ view: AppView, icon: React.ReactNode, label: string }> = ({ view, icon, label }) => (
    <button
      onClick={() => handleNavigate(view)}
      className={`w-full flex items-center ${isSidebarOpen ? 'gap-2 sm:gap-3 px-3 sm:px-4' : 'justify-center px-0'} py-2 sm:py-3 rounded-lg transition-colors text-sm sm:text-base ${currentView === view ? 'bg-wine-800 text-white shadow-lg' : 'text-wine-100 hover:bg-wine-800/50'}`}
      title={!isSidebarOpen ? label : undefined}
    >
      <div className="shrink-0 w-5 h-5 sm:w-6 sm:h-6">{icon}</div>
      {isSidebarOpen && <span className="font-medium truncate">{label}</span>}
    </button>
  );

  const NavCategoryBtn = ({ title, isOpen, onClick }: { title: string, isOpen: boolean, onClick: () => void }) => (
    <button
      onClick={onClick}
      className={`w-full flex items-center ${isSidebarOpen ? 'justify-between px-3 sm:px-4' : 'justify-center'} py-2 text-xs font-semibold text-wine-300 uppercase tracking-wider hover:text-white transition-colors focus:outline-none mb-1 mt-3 sm:mt-4 first:mt-2`}
      title={!isSidebarOpen ? title : undefined}
    >
      {isSidebarOpen ? (
        <>
          <span>{title}</span>
          {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </>
      ) : (
        <div className="w-3 h-px bg-wine-700 rounded-full" />
      )}
    </button>
  );

  // Menu montado a partir do registro de módulos: só aparecem telas de
  // módulos ligados que o papel do usuário pode abrir.
  const normalizedQuery = menuQuery.trim().toLowerCase();
  const isSuperAdminMode = isPlatformAdmin && !impersonatedStore;

  const menuSections = isSuperAdminMode
    ? [
        {
          key: 'sistema' as ModuleCategory,
          label: 'Administração SaaS',
          items: [
            { view: 'DASHBOARD' as AppView, label: 'Painel de Assinaturas' },
            { view: 'STORE_ADMIN' as AppView, label: 'Clientes & Lojas' },
            { view: 'SETTINGS' as AppView, label: 'Configurações' },
          ].filter(v => !normalizedQuery || v.label.toLowerCase().includes(normalizedQuery)),
        },
      ].filter(s => s.items.length > 0)
    : MODULE_CATEGORIES.map(cat => ({
        ...cat,
        items: MODULES
          .filter(m => m.category === cat.key)
          .flatMap(m => m.views)
          .filter(v => v.inMenu && canAccessView(v.view))
          .filter(v => !normalizedQuery || v.label.toLowerCase().includes(normalizedQuery)),
      })).filter(section => section.items.length > 0);

  return (
    <div className={`flex h-screen bg-wine-50 dark:bg-slate-900 overflow-hidden font-sans transition-colors duration-300 ${darkMode ? 'dark' : ''} print:h-auto print:overflow-visible`}>
      <NotificationContainer />
      <DialogHost />
      {/* Sidebar */}
      <aside
        className={`${isSidebarOpen ? 'translate-x-0 w-64' : '-translate-x-full md:translate-x-0 w-64 md:w-20'} fixed md:relative z-30 h-full bg-wine-900 text-white transition-all duration-300 ease-in-out flex flex-col shadow-xl print:hidden overflow-hidden`}
      >
        <button
          onClick={() => navigateTo('DASHBOARD')}
          className={`p-4 sm:p-6 border-b border-wine-800 flex items-center ${isSidebarOpen ? 'gap-3 justify-start' : 'justify-center'} hover:bg-wine-800 transition-colors text-left w-full focus:outline-none flex-shrink-0`}
        >
          <TrendingUp className="w-6 h-6 sm:w-8 sm:h-8 text-white shrink-0" />
          {isSidebarOpen && (
            <span className="text-base sm:text-xl font-bold tracking-tight truncate" title={isSuperAdminMode ? 'Gestão Pro Admin' : companySettings.name}>
              {isSuperAdminMode ? 'Gestão Pro Admin' : companySettings.name}
            </span>
          )}
        </button>

        <nav className="flex-1 overflow-y-auto p-3 sm:p-4 custom-scrollbar">
          {isSidebarOpen && (
            <div className="relative mb-2">
              <Search size={14} className="absolute left-2.5 top-2.5 text-wine-300" aria-hidden />
              <input
                ref={searchRef}
                type="search"
                value={menuQuery}
                onChange={e => setMenuQuery(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    const first = menuSections[0]?.items[0];
                    if (first) { handleNavigate(first.view); setMenuQuery(''); }
                  } else if (e.key === 'Escape') {
                    setMenuQuery('');
                    searchRef.current?.blur();
                  }
                }}
                placeholder="Buscar tela (Ctrl+K)"
                aria-label="Buscar tela no menu"
                className="w-full pl-8 pr-2 py-1.5 rounded-lg bg-wine-800/60 text-sm text-white placeholder-wine-300 outline-none focus:ring-2 focus:ring-wine-400"
              />
            </div>
          )}
          {menuSections.length === 0 && isSidebarOpen && (
            <p className="px-3 py-4 text-sm text-wine-300">Nenhuma tela encontrada.</p>
          )}
          {menuSections.map(section => (
            <div key={section.key}>
              <NavCategoryBtn
                title={section.label}
                isOpen={!!expandedSections[section.key] || !!normalizedQuery}
                onClick={() => toggleSection(section.key)}
              />
              {(expandedSections[section.key] || !!normalizedQuery || !isSidebarOpen) && (
                <div className="space-y-0.5 sm:space-y-1 animate-fade-in-down">
                  {section.items.map(item => (
                    <NavItem key={item.view} view={item.view} icon={VIEW_ICONS[item.view]} label={item.label} />
                  ))}
                </div>
              )}
            </div>
          ))}
        </nav>

        <div className="p-3 sm:p-4 border-t border-wine-800">
          {isSidebarOpen && (
            <div className="px-3 sm:px-4 py-2 mb-2 text-xs text-wine-300">
              <span className="opacity-75">Acesso: </span>
              <span className="font-bold text-white uppercase">{role ? ROLE_LABELS[role] : 'Sem acesso'}</span>
            </div>
          )}
          <button
            onClick={() => {
              signOut();
            }}
            className={`flex items-center ${isSidebarOpen ? 'gap-2 sm:gap-3 px-3 sm:px-4' : 'justify-center px-0'} py-2 sm:py-2 text-wine-200 hover:text-white hover:bg-wine-800 rounded-lg transition-colors w-full text-sm sm:text-base`}
            title={!isSidebarOpen ? 'Sair' : undefined}
          >
            <LogOut size={18} className="shrink-0 sm:w-5 sm:h-5" />
            {isSidebarOpen && <span>Sair</span>}
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col h-full overflow-hidden print:overflow-visible print:h-auto">
        {/* Banner Obrigatório de Impersonação / Modo Suporte */}
        {impersonatedStore && (
          <div className="bg-amber-500 text-zinc-950 font-medium px-4 py-2 flex items-center justify-between text-xs sm:text-sm z-30 shadow-sm shrink-0 border-b border-amber-600">
            <div className="flex items-center gap-2">
              <span className="text-base" role="img" aria-label="Aviso">⚠️</span>
              <span>
                <strong>Modo Suporte / Impersonação:</strong> Você está visualizando a loja <u>{impersonatedStore.name}</u>.
              </span>
            </div>
            <button
              onClick={stopImpersonation}
              className="bg-zinc-950 text-white px-3 py-1 rounded-md text-xs font-bold hover:bg-zinc-800 transition-colors shadow-xs"
            >
              Encerrar Suporte e Voltar ao Admin
            </button>
          </div>
        )}
        <SubscriptionBanner />
        {/* Topbar */}
        <header className="h-14 sm:h-16 bg-white dark:bg-slate-800 border-b border-wine-100 dark:border-slate-700 flex items-center justify-between px-3 sm:px-6 shadow-sm z-20 transition-colors duration-200 print:hidden gap-2 sm:gap-4">
          <button onClick={() => setSidebarOpen(!isSidebarOpen)} className="text-wine-600 dark:text-wine-100 hover:text-wine-900 transition-colors focus:outline-none p-2 -ml-2 sm:-ml-4" title="Alternar Menu">
            <Menu size={20} className="sm:w-6 sm:h-6" />
          </button>

          {/* Troca de loja: só aparece para quem participa de mais de uma loja */}
          {stores.length > 1 && activeStore && (
            <label className="flex items-center gap-2 text-sm text-wine-800 dark:text-slate-200 min-w-0">
              <StoreIcon size={18} className="shrink-0 text-wine-600 dark:text-wine-300" />
              <span className="sr-only">Loja ativa</span>
              <select
                value={activeStore.id}
                onChange={e => handleSwitchStore(e.target.value)}
                className="max-w-[10rem] sm:max-w-xs truncate bg-wine-50 dark:bg-slate-700 border border-wine-100 dark:border-slate-600 rounded-lg px-2 py-1.5 font-semibold focus:outline-none focus:ring-2 focus:ring-wine-500"
              >
                {stores.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </label>
          )}

          <div className="flex items-center gap-2 sm:gap-4 ml-auto">
            <button
              onClick={() => handleToggleMobileMode(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-gradient-to-r from-red-950 via-wine-900 to-rose-900 text-white hover:from-red-900 hover:to-rose-800 text-xs font-bold shadow-md shadow-red-950/40 transition-all active:scale-95 border border-rose-700/40"
              title="Alternar para visualização Mobile-First"
            >
              <Smartphone size={15} />
              <span className="hidden sm:inline">Modo Mobile</span>
            </button>

            <button
              onClick={() => {
                refreshData();
                addNotification('Sincronizando dados...', 'info');
              }}
              className="p-2 rounded-full hover:bg-wine-50 dark:hover:bg-slate-700 text-wine-600 dark:text-wine-100 transition-all hover:rotate-180 duration-500"
              title="Sincronizar Dados"
            >
              <RefreshCcw size={18} className="sm:w-5 sm:h-5" />
            </button>

            <button
              onClick={toggleDarkMode}
              className="p-2 rounded-full hover:bg-wine-50 dark:hover:bg-slate-700 text-wine-600 dark:text-yellow-400 transition-colors"
              title="Alternar Tema"
            >
              {darkMode ? <Sun size={18} className="sm:w-5 sm:h-5" /> : <Moon size={18} className="sm:w-5 sm:h-5" />}
            </button>

            <div className="text-right hidden sm:block">
              <p className="text-sm font-bold text-wine-900 dark:text-white">{user.email}</p>
              <p className="text-xs text-wine-500 dark:text-slate-400">
                {role ? ROLE_LABELS[role] : 'Usuário'}{activeStore && stores.length <= 1 ? ` · ${activeStore.name}` : ''}
              </p>
            </div>
            <div className="w-9 h-9 sm:w-10 sm:h-10 bg-wine-100 dark:bg-slate-700 text-wine-900 dark:text-wine-100 rounded-full flex items-center justify-center font-bold text-sm sm:text-base">
              {user.email?.charAt(0).toUpperCase()}
            </div>
          </div>
        </header>

        {/* View Area */}
        <main className="flex-1 overflow-y-auto p-3 sm:p-4 md:p-6 bg-wine-50 dark:bg-slate-900 transition-colors duration-200 print:overflow-visible print:h-auto print:p-0">
          <div className="w-full max-w-screen-2xl mx-auto animate-fade-in">
            <Suspense fallback={<LoadingScreen message="Carregando tela..." />}>
              {renderView()}
            </Suspense>
          </div>
        </main>
      </div>

      {/* Mobile Overlay */}
      {isSidebarOpen && (
        <div
          onClick={() => setSidebarOpen(false)}
          className="md:hidden fixed inset-0 bg-wine-950/50 backdrop-blur-sm z-20"
        />
      )}
    </div>
  );
};

/** Ativa o push automaticamente só nas lojas com o módulo de notificações ligado. */
const PushGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isModuleEnabled } = useStore();
  return (
    <PushNotificationProvider autoEnable={isModuleEnabled('push_notifications')}>
      {children}
    </PushNotificationProvider>
  );
};

const App: React.FC = () => {
  return (
    <AuthProvider>
      <StoreProvider>
        <AppProvider>
          <PushGate>
            <AppContent />
          </PushGate>
        </AppProvider>
      </StoreProvider>
    </AuthProvider>
  );
};

export default App;
