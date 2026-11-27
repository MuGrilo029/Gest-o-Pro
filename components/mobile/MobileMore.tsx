import React, { Suspense, useState } from 'react';
import {
  ArrowLeft, ChevronRight, Monitor, Store as StoreIcon, UserCheck, FileSpreadsheet, Truck, Settings, Wrench,
  ArrowDownCircle, ArrowUpCircle, FileText, TrendingUp, Boxes, Users, ClipboardList, PackageSearch,
} from 'lucide-react';
import { AppView } from '../../types';
import { useAppStore } from '../../store';
import { useStore } from '../../contexts/StoreContext';
import { MODULES, MODULE_CATEGORIES } from '../../lib/modules';
import { ResponsiveTables } from '../ResponsiveTables';

// Telas do desktop reaproveitadas no celular (carregadas só quando abertas).
const lazyPage = <T extends Record<string, any>>(loader: () => Promise<T>, name: keyof T) =>
  React.lazy(() => loader().then(m => ({ default: m[name] as React.ComponentType<any> })));

const Customers = lazyPage(() => import('../../pages/Customers'), 'Customers');
const Quotes = lazyPage(() => import('../../pages/Quotes'), 'Quotes');
const Deliveries = lazyPage(() => import('../../pages/Deliveries'), 'Deliveries');
const Financial = lazyPage(() => import('../../pages/Financial'), 'Financial');
const SettingsPage = lazyPage(() => import('../../pages/Settings'), 'Settings');
const Suppliers = lazyPage(() => import('../../pages/Suppliers'), 'Suppliers');
const Orders = lazyPage(() => import('../../pages/Orders'), 'Orders');
const Production = lazyPage(() => import('../../pages/Production'), 'Production');
const Reports = lazyPage(() => import('../../pages/Reports'), 'Reports');
const Team = lazyPage(() => import('../../pages/Team'), 'Team');
const StockEntries = lazyPage(() => import('../../pages/StockEntries'), 'StockEntries');

const ICONS: Partial<Record<AppView, React.ReactNode>> = {
  CUSTOMERS: <UserCheck size={20} />,
  QUOTES: <FileSpreadsheet size={20} />,
  DELIVERIES: <Truck size={20} />,
  PAYABLES: <ArrowDownCircle size={20} />,
  RECEIVABLES: <ArrowUpCircle size={20} />,
  BOLETOS: <FileText size={20} />,
  SETTINGS: <Settings size={20} />,
  SUPPLIERS: <Boxes size={20} />,
  ORDERS: <PackageSearch size={20} />,
  PRODUCTION: <Wrench size={20} />,
  REPORTS: <TrendingUp size={20} />,
  TEAM: <Users size={20} />,
  STORE_ADMIN: <StoreIcon size={20} />,
  STOCK_LOGS: <ClipboardList size={20} />,
};

/** Telas que já existem como aba própria no celular. */
const NATIVE_TABS: AppView[] = ['DASHBOARD', 'SALES', 'SALES_HISTORY', 'INVENTORY'];

const renderPage = (view: AppView) => {
  switch (view) {
    case 'CUSTOMERS': return <Customers />;
    case 'QUOTES': return <Quotes />;
    case 'DELIVERIES': return <Deliveries />;
    case 'PAYABLES': return <Financial type="PAYABLES" />;
    case 'RECEIVABLES': return <Financial type="RECEIVABLES" />;
    case 'BOLETOS': return <Financial type="BOLETOS" />;
    case 'SETTINGS': return <SettingsPage />;
    case 'SUPPLIERS': return <Suppliers />;
    case 'ORDERS': return <Orders />;
    case 'PRODUCTION': return <Production />;
    case 'REPORTS': return <Reports />;
    case 'TEAM': return <Team />;
    case 'STOCK_LOGS': return <StockEntries />;
    default: return null;
  }
};

interface MobileMoreProps {
  onSwitchToDesktop?: () => void;
}

/** Aba "Mais": todas as outras telas do sistema, troca de loja e volta ao desktop. */
export const MobileMore: React.FC<MobileMoreProps> = ({ onSwitchToDesktop }) => {
  const { navigateTo, darkMode } = useAppStore();
  const { canAccessView, stores, activeStore, switchStore } = useStore();
  const [openView, setOpenView] = useState<AppView | null>(null);

  const sections = MODULE_CATEGORIES.map(cat => ({
    ...cat,
    items: MODULES
      .filter(m => m.category === cat.key)
      .flatMap(m => m.views)
      .filter(v => v.inMenu && !NATIVE_TABS.includes(v.view) && canAccessView(v.view)),
  })).filter(s => s.items.length > 0);

  const open = (view: AppView, label: string) => {
    navigateTo(view); // mantém o "tela atual" do sistema coerente com o que está aberto
    setOpenView(view);
    void label;
  };

  if (openView) {
    const label = MODULES.flatMap(m => m.views).find(v => v.view === openView)?.label || '';
    return (
      <div className="space-y-3">
        <button
          onClick={() => setOpenView(null)}
          className="flex items-center gap-2 text-sm font-semibold text-slate-200 px-1 py-1"
          aria-label="Voltar para Mais"
        >
          <ArrowLeft size={18} /> {label}
        </button>
        <div className={`${darkMode ? 'dark' : ''}`}>
          <div className="bg-wine-50 dark:bg-slate-900 rounded-2xl p-3 text-wine-950 dark:text-slate-100 overflow-x-auto">
            <ResponsiveTables always>
              <Suspense fallback={<p className="text-sm text-slate-400 p-4">Carregando...</p>}>
                {renderPage(openView)}
              </Suspense>
            </ResponsiveTables>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <h2 className="text-lg font-bold text-white">Mais</h2>

      {stores.length > 1 && activeStore && (
        <label className="block p-3.5 rounded-2xl bg-[#111827]/80 border border-white/10">
          <span className="flex items-center gap-2 text-xs font-semibold text-slate-300 mb-2">
            <StoreIcon size={14} /> Loja ativa
          </span>
          <select
            value={activeStore.id}
            onChange={e => { switchStore(e.target.value).catch(() => undefined); }}
            className="w-full bg-slate-800 text-white text-sm rounded-xl px-3 py-2 border border-white/10 outline-none focus:ring-2 focus:ring-wine-500"
          >
            {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
      )}

      {sections.map(section => (
        <div key={section.key} className="space-y-2">
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 px-1">{section.label}</p>
          <ul className="rounded-2xl bg-[#111827]/80 border border-white/10 divide-y divide-white/5 overflow-hidden">
            {section.items.map(item => (
              <li key={item.view}>
                <button
                  onClick={() => open(item.view, item.label)}
                  className="w-full flex items-center gap-3 px-4 py-3.5 text-left text-slate-100 hover:bg-white/5 active:bg-white/10"
                >
                  <span className="text-rose-400 shrink-0">{ICONS[item.view]}</span>
                  <span className="flex-1 text-sm font-medium">{item.label}</span>
                  <ChevronRight size={16} className="text-slate-500" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}

      {onSwitchToDesktop && (
        <button
          onClick={onSwitchToDesktop}
          className="w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl bg-[#111827]/80 border border-white/10 text-slate-100 text-left"
        >
          <Monitor size={20} className="text-rose-400" />
          <span className="flex-1 text-sm font-medium">Usar versão desktop</span>
          <ChevronRight size={16} className="text-slate-500" />
        </button>
      )}
    </div>
  );
};
