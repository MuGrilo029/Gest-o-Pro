import React, { useEffect, useRef } from 'react';

/** Copia o texto dos cabeçalhos para data-label das células, usado pelo modo cartão (index.css). */
const labelTables = (root: HTMLElement) => {
  root.querySelectorAll('table').forEach(table => {
    const headRows = table.querySelectorAll('thead tr');
    const headRow = headRows[headRows.length - 1];
    if (!headRow) return;
    const labels = Array.from(headRow.children).map(h => (h.textContent || '').trim());
    table.querySelectorAll('tbody tr').forEach(tr => {
      const cells = Array.from(tr.children) as HTMLElement[];
      // Só rotula linhas que têm uma célula por coluna (linhas com colspan ficam como estão).
      if (cells.length !== labels.length) return;
      cells.forEach((td, i) => {
        if (labels[i] && td.getAttribute('data-label') !== labels[i]) td.setAttribute('data-label', labels[i]);
      });
    });
  });
};

/**
 * Envolve conteúdo com tabelas e as exibe como cartões em telas pequenas.
 * always = sempre em cartões (usado dentro do app mobile).
 */
export const ResponsiveTables: React.FC<{ children: React.ReactNode; always?: boolean; className?: string }> = ({ children, always, className = '' }) => {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    labelTables(el);
    const observer = new MutationObserver(() => labelTables(el));
    observer.observe(el, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);
  return <div ref={ref} className={`${always ? 'cards-always' : 'cards-on-mobile'} ${className}`}>{children}</div>;
};
