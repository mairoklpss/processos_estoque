import { AlertTriangle, CheckCircle2, Clock, FileEdit, PackageCheck } from 'lucide-react';
import type { ComparacaoLimites, StatusSeparacao } from '../shared/types.ts';

export function StatusSeparacaoLabel({ status }: { status: StatusSeparacao }) {
  if (status === 'RASCUNHO') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-800 whitespace-nowrap">
        <FileEdit className="w-3.5 h-3.5 text-amber-700 shrink-0" aria-hidden="true" />
        <span>Rascunho</span>
      </span>
    );
  }
  if (status === 'CALCULADA') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-800 whitespace-nowrap">
        <Clock className="w-3.5 h-3.5 text-blue-700 shrink-0" aria-hidden="true" />
        <span>Calculada (na fila)</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-800 whitespace-nowrap">
      <PackageCheck className="w-3.5 h-3.5 text-emerald-700 shrink-0" aria-hidden="true" />
      <span>Separada</span>
    </span>
  );
}

export function ComparacaoLimitesLabel({ comparacao }: { comparacao: ComparacaoLimites }) {
  if (comparacao === 'ABAIXO_MINIMO') {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-800">
        <AlertTriangle className="w-3.5 h-3.5 text-amber-700 shrink-0" aria-hidden="true" />
        <span>Uso abaixo do mínimo</span>
      </span>
    );
  }
  if (comparacao === 'ACIMA_MAXIMO') {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-red-800">
        <AlertTriangle className="w-3.5 h-3.5 text-red-700 shrink-0" aria-hidden="true" />
        <span>Uso acima do máximo</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-800">
      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700 shrink-0" aria-hidden="true" />
      <span>Uso dentro dos limites</span>
    </span>
  );
}
