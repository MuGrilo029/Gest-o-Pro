

import React, { useEffect } from 'react';
import { X, Inbox } from 'lucide-react';
import { ResponsiveTables } from './ResponsiveTables';

export const Card: React.FC<{ children: React.ReactNode, className?: string, title?: string, onClick?: (e: React.MouseEvent) => void }> = ({ children, className = '', title, onClick }) => (
  <div onClick={onClick} className={`bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-wine-100 dark:border-slate-700 overflow-hidden transition-colors duration-200 ${className} ${onClick ? 'cursor-pointer hover:shadow-md' : ''}`}>
    {title && <div className="px-6 py-4 border-b border-wine-100 dark:border-slate-700 font-semibold text-wine-900 dark:text-wine-50">{title}</div>}
    <div className="p-6">{children}</div>
  </div>
);

export const Button: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger' | 'outline' }> = ({ variant = 'primary', className = '', ...props }) => {
  const baseStyle = "px-4 py-2 rounded-lg font-medium transition-all duration-200 flex items-center gap-2 justify-center";
  const variants = {
    primary: "bg-wine-900 text-white hover:bg-wine-800 shadow-md shadow-wine-900/10 dark:bg-wine-700 dark:hover:bg-wine-600",
    secondary: "bg-wine-100 text-wine-900 hover:bg-wine-200 dark:bg-slate-700 dark:text-wine-100 dark:hover:bg-slate-600",
    danger: "bg-red-50 text-red-600 hover:bg-red-100 dark:bg-red-900/20 dark:text-red-400 dark:hover:bg-red-900/30",
    outline: "border border-wine-200 text-wine-700 hover:bg-wine-50 dark:border-slate-600 dark:text-wine-100 dark:hover:bg-slate-700"
  };
  return <button className={`${baseStyle} ${variants[variant]} ${className}`} {...props} />;
};

export const Input: React.FC<React.InputHTMLAttributes<HTMLInputElement> & { label?: string }> = ({ label, className = '', ...props }) => (
  <div className="flex flex-col gap-1 w-full">
    {label && <label className="text-xs font-semibold text-wine-600 dark:text-wine-300 uppercase tracking-wider">{label}</label>}
    <input
      className={`border border-wine-200 dark:border-slate-600 bg-wine-50 dark:bg-slate-700 rounded-lg px-3 py-2 focus:ring-2 focus:ring-wine-500 focus:border-transparent outline-none transition-all placeholder-wine-400 dark:placeholder-slate-400 text-black dark:text-white ${className}`}
      onFocus={(e) => e.target.select()}
      {...props}
    />
  </div>
);

export const Select: React.FC<React.SelectHTMLAttributes<HTMLSelectElement> & { label?: string }> = ({ label, className = '', children, ...props }) => (
  <div className="flex flex-col gap-1 w-full">
    {label && <label className="text-xs font-semibold text-wine-600 dark:text-wine-300 uppercase tracking-wider">{label}</label>}
    <select className={`border border-wine-200 dark:border-slate-600 bg-wine-50 dark:bg-slate-700 rounded-lg px-3 py-2 focus:ring-2 focus:ring-wine-500 focus:border-transparent outline-none transition-all text-black dark:text-white ${className}`} {...props}>
      {children}
    </select>
  </div>
);

export const SearchableSelect: React.FC<{
  label?: string;
  value: string;
  onChange: (val: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
  className?: string;
}> = ({ label, value, onChange, options, placeholder = "Selecione...", className = '' }) => {
  const [isOpen, setIsOpen] = React.useState(false);
  const [searchTerm, setSearchTerm] = React.useState('');
  const wrapperRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filteredOptions = options.filter(opt => 
    opt.label.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const selectedLabel = options.find(opt => opt.value === value)?.label || '';

  return (
    <div className="flex flex-col gap-1 w-full relative" ref={wrapperRef}>
      {label && <label className="text-xs font-semibold text-wine-600 dark:text-wine-300 uppercase tracking-wider">{label}</label>}
      <div 
        className={`border border-wine-200 dark:border-slate-600 bg-wine-50 dark:bg-slate-700 rounded-lg px-3 py-2 cursor-pointer flex justify-between items-center transition-all text-black dark:text-white ${className}`}
        onClick={() => { setIsOpen(!isOpen); setSearchTerm(''); }}
      >
        <span className={selectedLabel ? '' : 'text-wine-400 dark:text-slate-400'}>
          {selectedLabel || placeholder}
        </span>
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`transition-transform ${isOpen ? 'rotate-180' : ''}`}><polyline points="6 9 12 15 18 9"></polyline></svg>
      </div>

      {isOpen && (
        <div className="absolute top-[100%] left-0 right-0 mt-1 bg-white dark:bg-slate-800 border border-wine-200 dark:border-slate-600 rounded-lg shadow-xl z-50 max-h-60 flex flex-col overflow-hidden">
          <div className="p-2 border-b border-wine-100 dark:border-slate-700">
            <input
              type="text"
              autoFocus
              placeholder="Buscar..."
              className="w-full bg-wine-50/50 dark:bg-slate-900 border border-wine-200 dark:border-slate-600 rounded px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-wine-500"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              onClick={e => e.stopPropagation()}
            />
          </div>
          <div className="overflow-y-auto custom-scrollbar flex-1">
            {filteredOptions.length > 0 ? (
              filteredOptions.map(opt => (
                <div
                  key={opt.value}
                  className={`px-3 py-2 text-sm cursor-pointer hover:bg-wine-50 dark:hover:bg-slate-700 transition-colors ${value === opt.value ? 'bg-wine-100 dark:bg-slate-600 font-medium' : ''}`}
                  onClick={() => {
                    onChange(opt.value);
                    setIsOpen(false);
                  }}
                >
                  {opt.label}
                </div>
              ))
            ) : (
              <div className="px-3 py-4 text-sm text-center text-slate-500">Nenhum resultado</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export const Badge: React.FC<{ children: React.ReactNode, color: 'green' | 'red' | 'yellow' | 'blue' | 'gray' }> = ({ children, color }) => {
  const colors = {
    green: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
    red: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
    yellow: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
    blue: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
    gray: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
  };
  return <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${colors[color]}`}>{children}</span>;
};

export type SemanticStatus = 'active' | 'trial' | 'trialing' | 'past_due' | 'suspended' | 'cancelled' | 'paused' | 'expired';

export const StatusBadge: React.FC<{
  status: SemanticStatus | string;
  label?: string;
  className?: string;
}> = ({ status, label, className = '' }) => {
  const norm = status.toLowerCase();
  let bg = 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300';
  let dot = 'bg-zinc-400';
  let text = label || status;

  if (norm === 'active') {
    bg = 'bg-emerald-50 text-emerald-700 border border-emerald-200/60 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-800/40';
    dot = 'bg-emerald-500';
    text = label || 'Ativa';
  } else if (norm === 'trial' || norm === 'trialing') {
    bg = 'bg-indigo-50 text-indigo-700 border border-indigo-200/60 dark:bg-indigo-950/40 dark:text-indigo-400 dark:border-indigo-800/40';
    dot = 'bg-indigo-500';
    text = label || 'Em Teste';
  } else if (norm === 'past_due') {
    bg = 'bg-amber-50 text-amber-700 border border-amber-200/60 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800/40';
    dot = 'bg-amber-500';
    text = label || 'Atrasada';
  } else if (norm === 'suspended') {
    bg = 'bg-orange-50 text-orange-700 border border-orange-200/60 dark:bg-orange-950/40 dark:text-orange-400 dark:border-orange-800/40';
    dot = 'bg-orange-500';
    text = label || 'Suspensa';
  } else if (norm === 'cancelled') {
    bg = 'bg-rose-50 text-rose-700 border border-rose-200/60 dark:bg-rose-950/40 dark:text-rose-400 dark:border-rose-800/40';
    dot = 'bg-rose-500';
    text = label || 'Cancelada';
  } else if (norm === 'paused') {
    bg = 'bg-zinc-100 text-zinc-700 border border-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:border-zinc-700';
    dot = 'bg-zinc-400';
    text = label || 'Pausada';
  } else if (norm === 'expired') {
    bg = 'bg-rose-50 text-rose-700 border border-rose-200/60 dark:bg-rose-950/40 dark:text-rose-400 dark:border-rose-800/40';
    dot = 'bg-rose-500';
    text = label || 'Expirada';
  }

  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium tracking-tight ${bg} ${className}`}>
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dot}`} />
      <span>{text}</span>
    </span>
  );
};

export const Drawer: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}> = ({ isOpen, onClose, title, subtitle, children }) => {
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
      const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
      window.addEventListener('keydown', onEsc);
      return () => {
        document.body.style.overflow = 'unset';
        window.removeEventListener('keydown', onEsc);
      };
    }
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-hidden">
      <div 
        className="fixed inset-0 bg-zinc-950/50 backdrop-blur-xs transition-opacity animate-fade-in"
        onClick={onClose}
      />
      <div className="fixed inset-y-0 right-0 max-w-full flex pl-10">
        <div className="w-screen max-w-xl bg-white dark:bg-zinc-900 border-l border-zinc-200 dark:border-zinc-800 shadow-2xl flex flex-col animate-slide-in-right">
          <div className="p-6 border-b border-zinc-200 dark:border-zinc-800 flex items-start justify-between bg-zinc-50/50 dark:bg-zinc-900/50">
            <div>
              <h2 className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">{title}</h2>
              {subtitle && <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">{subtitle}</p>}
            </div>
            <button
              onClick={onClose}
              className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 p-1 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
              aria-label="Fechar"
            >
              <X size={20} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar text-zinc-900 dark:text-zinc-100">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
};


export const Table: React.FC<{ headers: (string | React.ReactNode)[], children: React.ReactNode }> = ({ headers, children }) => (
  <ResponsiveTables className="overflow-x-auto w-full">
    <table className="w-full text-left border-collapse">
      <thead>
        <tr className="border-b border-wine-100 dark:border-slate-700">
          {headers.map((h, i) => (
            <th key={i} className="py-3 px-4 text-xs font-semibold text-wine-600 dark:text-wine-300 uppercase bg-wine-50/50 dark:bg-slate-700/50 first:rounded-tl-lg last:rounded-tr-lg">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y divide-wine-100 dark:divide-slate-700 text-wine-900 dark:text-wine-100">
        {children}
      </tbody>
    </table>
  </ResponsiveTables>
);

export const Modal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}> = ({ isOpen, onClose, title, children }) => {
  // Prevent scrolling on body when modal is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => { document.body.style.overflow = 'unset'; };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-wine-950/40 dark:bg-black/60 backdrop-blur-sm p-4 animate-fade-in">
      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-2xl animate-scale-in relative flex flex-col max-h-[90vh] border border-wine-100 dark:border-slate-700">
        <div className="flex justify-between items-center p-6 border-b border-wine-100 dark:border-slate-700 flex-shrink-0">
          <h3 className="text-xl font-bold text-wine-900 dark:text-white">{title}</h3>
          <button onClick={onClose} className="text-wine-300 hover:text-wine-600 dark:text-slate-400 dark:hover:text-white transition-colors p-1 rounded-full hover:bg-wine-50 dark:hover:bg-slate-700">
            <X size={24} />
          </button>
        </div>
        <div className="p-6 overflow-y-auto custom-scrollbar dark:text-wine-50">
          {children}
        </div>
      </div>
    </div>
  );
};

// Utility function for CPF/CNPJ Mask
export const formatCpfCnpj = (value: string) => {
  const v = value.replace(/\D/g, ''); // Remove non-digits

  if (v.length > 14) return value.substring(0, 18); // Limit length

  if (v.length <= 11) {
    // CPF Mask: 999.999.999-99
    return v
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d{1,2})$/, '$1-$2');
  }

  // CNPJ Mask: 99.999.999/9999-99
  return v
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2')
    .replace(/(\d{4})(\d)/, '$1-$2');
};

/** Estado vazio com explicação e, se houver, uma ação. */
export const EmptyState: React.FC<{
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  icon?: React.ReactNode;
}> = ({ title, description, actionLabel, onAction, icon }) => (
  <div className="flex flex-col items-center justify-center text-center gap-2 py-10 px-4">
    <div className="text-wine-300 dark:text-slate-500">{icon ?? <Inbox size={36} />}</div>
    <p className="font-semibold text-wine-900 dark:text-white">{title}</p>
    {description && <p className="text-sm text-wine-500 dark:text-slate-400 max-w-sm">{description}</p>}
    {actionLabel && onAction && (
      <Button type="button" className="mt-2" onClick={onAction}>{actionLabel}</Button>
    )}
  </div>
);

// Utility function for Phone Mask (DD) XXXXX-XXXX
export const formatPhone = (value: string) => {
  const v = value.replace(/\D/g, ''); // Remove non-digits

  if (v.length > 11) return value.substring(0, 15);

  if (v.length <= 10) {
    // Landline: (DD) XXXX-XXXX
    return v
      .replace(/(\d{2})(\d)/, '($1) $2')
      .replace(/(\d{4})(\d)/, '$1-$2');
  } else {
    // Mobile: (DD) XXXXX-XXXX
    return v
      .replace(/(\d{2})(\d)/, '($1) $2')
      .replace(/(\d{5})(\d)/, '$1-$2');
  }
};
/** Cabeçalho padrão de página: título, subtítulo e a ação principal. */
export const PageHeader: React.FC<{
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}> = ({ title, subtitle, actions }) => (
  <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
    <div className="min-w-0">
      <h2 className="text-2xl font-bold text-wine-900 dark:text-white">{title}</h2>
      {subtitle && <p className="text-sm text-wine-600 dark:text-slate-400">{subtitle}</p>}
    </div>
    {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
  </div>
);

/** Diálogo de confirmação/aviso (substitui confirm()/alert() do navegador). */
export const ConfirmDialog: React.FC<{
  isOpen: boolean;
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string | null; // null = só botão OK (aviso)
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}> = ({ isOpen, title = 'Confirmar', message, confirmLabel = 'Confirmar', cancelLabel = 'Cancelar', danger, onConfirm, onCancel }) => {
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onCancel]);
  if (!isOpen) return null;
  return (
    <div role="alertdialog" aria-modal="true" aria-label={title}
      className="fixed inset-0 z-[200] flex items-center justify-center bg-wine-950/40 dark:bg-black/60 backdrop-blur-sm p-4"
      onClick={onCancel}>
      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-md p-6 border border-wine-100 dark:border-slate-700" onClick={e => e.stopPropagation()}>
        <h3 className="text-lg font-bold text-wine-900 dark:text-white mb-2">{title}</h3>
        <p className="text-sm text-wine-700 dark:text-slate-300 whitespace-pre-line mb-6">{message}</p>
        <div className="flex justify-end gap-2">
          {cancelLabel !== null && <Button type="button" variant="outline" autoFocus={!!danger} onClick={onCancel}>{cancelLabel}</Button>}
          <Button type="button" variant={danger ? 'danger' : 'primary'} autoFocus={!danger} onClick={onConfirm}>{confirmLabel}</Button>
        </div>
      </div>
    </div>
  );
};

type DialogRequest = {
  message: string; title?: string; confirmLabel?: string; cancelLabel?: string | null; danger?: boolean;
  resolve: (ok: boolean) => void;
};
let dialogListener: ((req: DialogRequest) => void) | null = null;

const openDialog = (req: Omit<DialogRequest, 'resolve'>) =>
  new Promise<boolean>(resolve => {
    if (!dialogListener) { resolve(false); return; } // sem host montado: nunca confirma sozinho
    dialogListener({ ...req, resolve });
  });

const DANGER_RE = /exclu|remov|apag|suspend|desligar/i;

/** Pede confirmação ao usuário. Uso: if (await confirmDialog('Excluir?')) { ... } */
export const confirmDialog = (message: string, opts: { title?: string; confirmLabel?: string; danger?: boolean } = {}) =>
  openDialog({ message, title: opts.title ?? 'Confirmar', confirmLabel: opts.confirmLabel ?? 'Confirmar', danger: opts.danger ?? DANGER_RE.test(message) });

/** Mostra um aviso com botão OK. */
export const alertDialog = (message: string, title = 'Aviso') =>
  openDialog({ message, title, confirmLabel: 'OK', cancelLabel: null }).then(() => undefined);

/** Montar uma vez na raiz do app (desktop e mobile). */
export const DialogHost: React.FC = () => {
  const [queue, setQueue] = React.useState<DialogRequest[]>([]);
  useEffect(() => {
    dialogListener = req => setQueue(q => [...q, req]);
    return () => { dialogListener = null; };
  }, []);
  const current = queue[0];
  const close = (ok: boolean) => {
    current?.resolve(ok);
    setQueue(q => q.slice(1));
  };
  return (
    <ConfirmDialog
      isOpen={!!current}
      title={current?.title}
      message={current?.message || ''}
      confirmLabel={current?.confirmLabel}
      cancelLabel={current?.cancelLabel}
      danger={current?.danger}
      onConfirm={() => close(true)}
      onCancel={() => close(false)}
    />
  );
};
