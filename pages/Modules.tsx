import React from 'react';
import { LayoutDashboard, DollarSign, ShoppingCart, Package, Settings, LogOut, Sun, Moon } from 'lucide-react';
import { useAppStore } from '../store';
import { useAuth } from '../contexts/AuthContext';
import { useStore } from '../contexts/StoreContext';
import { AppView } from '../types';
import { MODULES, MODULE_CATEGORIES, ModuleCategory } from '../lib/modules';

interface ModulesProps {
  onSelectModule: (view: AppView) => void;
}

const CATEGORY_CARDS: Record<ModuleCategory, { icon: React.ReactNode; description: string }> = {
  geral: { icon: <LayoutDashboard size={40} />, description: 'Dashboard e Relatórios' },
  financeiro: { icon: <DollarSign size={40} />, description: 'Contas a Pagar, Receber e Boletos' },
  comercial: { icon: <ShoppingCart size={40} />, description: 'Vendas, Orçamentos e Clientes' },
  operacao: { icon: <Package size={40} />, description: 'Estoque, Produção e Logística' },
  sistema: { icon: <Settings size={40} />, description: 'Configurações, Equipe e Módulos' },
};

export const Modules: React.FC<ModulesProps> = ({ onSelectModule }) => {
  const { darkMode, toggleDarkMode, companySettings } = useAppStore();
  const { signOut } = useAuth();
  const { canAccessView, activeStore } = useStore();

  // Um cartão por área, só se o usuário puder abrir alguma tela dela.
  const cards = MODULE_CATEGORIES.map(cat => {
    const firstView = MODULES
      .filter(m => m.category === cat.key)
      .flatMap(m => m.views)
      .find(v => v.inMenu && canAccessView(v.view))?.view;
    return { ...cat, ...CATEGORY_CARDS[cat.key], view: firstView };
  }).filter(c => !!c.view);

  return (
    <div className={`min-h-screen flex flex-col items-center justify-center bg-wine-50 dark:bg-slate-900 px-4 py-16 transition-colors duration-300 ${darkMode ? 'dark' : ''}`}>
      <div className="absolute top-6 right-6 flex items-center gap-4">
        <button
          onClick={toggleDarkMode}
          className="p-3 rounded-full bg-white dark:bg-slate-800 shadow-md hover:bg-wine-100 dark:hover:bg-slate-700 text-wine-600 dark:text-yellow-400 transition-colors"
          title="Alternar Tema"
        >
          {darkMode ? <Sun size={24} /> : <Moon size={24} />}
        </button>
        <button
          onClick={() => signOut()}
          className="flex items-center gap-2 px-6 py-3 bg-white dark:bg-slate-800 shadow-md hover:bg-red-50 dark:hover:bg-red-900/30 text-red-600 dark:text-red-400 rounded-full transition-colors font-medium"
        >
          <LogOut size={20} />
          Sair
        </button>
      </div>

      <div className="mb-12 text-center animate-fade-in-down">
        <img src="/favicon.svg" alt="Logo" className="w-24 h-24 mx-auto mb-6 drop-shadow-lg" />
        <h1 className="text-4xl font-extrabold text-wine-950 dark:text-white mb-3 tracking-tight">
          {companySettings.name || activeStore?.name || 'Gestão Pro'}
        </h1>
        <p className="text-lg text-wine-600 dark:text-wine-300 font-medium">Selecione o módulo que deseja acessar</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-8 max-w-7xl w-full px-4 animate-fade-in-up">
        {cards.map(card => (
          <button
            key={card.key}
            onClick={() => onSelectModule(card.view!)}
            className="bg-white dark:bg-slate-800 p-8 rounded-2xl shadow-xl hover:shadow-2xl hover:-translate-y-2 transition-all duration-300 flex flex-col items-center text-center group border border-wine-100 dark:border-slate-700 w-full"
          >
            <div className="w-20 h-20 bg-wine-50 dark:bg-slate-700 rounded-full flex items-center justify-center text-wine-600 dark:text-wine-400 group-hover:bg-wine-600 group-hover:text-white transition-colors duration-300 mb-6 shadow-sm">
              {card.icon}
            </div>
            <h3 className="text-2xl font-bold text-wine-950 dark:text-white mb-2">{card.label}</h3>
            <p className="text-wine-600 dark:text-slate-400">{card.description}</p>
          </button>
        ))}
      </div>
    </div>
  );
};
