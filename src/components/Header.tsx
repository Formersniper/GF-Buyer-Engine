import React from 'react';
import { Database, ShieldCheck, Activity } from 'lucide-react';
import { isSupabaseConfigured } from '../services/supabase/client';

interface HeaderProps {
  activeView: string;
  onViewChange: (view: string) => void;
  leadCounts: {
    total: number;
    hot: number;
    warm: number;
    nurture: number;
  };
}

export const Header: React.FC<HeaderProps> = ({
  activeView,
  onViewChange,
  leadCounts,
}) => {
  const navItems = [
    { id: 'import', label: '01 LEAD INTAKE' },
    { id: 'processing', label: '02 PIPELINE PROCESSING' },
    { id: 'buyers', label: '03 QUALIFIED BUYERS' },
    { id: 'buyer-detail', label: '04 BUYER PROFILE' },
    { id: 'matches', label: '05 PROJECT FIT' },
  ];

  const viewNameMap: Record<string, string> = {
    import: 'Phase1_Lead_Intake_Raw_CSV',
    processing: 'Phase1_Telemetry_Pipeline_Funnel',
    buyers: 'Phase1_Qualified_Buyer_Matrix',
    'buyer-detail': 'Phase1_Canonical_Buyer_Fact_Record',
    matches: 'Phase1_Project_Catalog_Fit_Engine',
  };

  return (
    <header id="app-header" className="sticky top-0 z-50 flex flex-col shrink-0">
      {/* Primary Navigation Bar (Slate-900 theme) */}
      <nav className="h-16 bg-slate-900 text-white flex items-center justify-between px-4 sm:px-8 shrink-0 border-b border-slate-800">
        <div className="flex items-center gap-4 sm:gap-6 overflow-x-auto py-1">
          {/* Brand Identity */}
          <div className="flex items-center gap-2.5 shrink-0 cursor-pointer" onClick={() => onViewChange('import')}>
            <div className="w-6 h-6 bg-indigo-500 rounded-xs flex items-center justify-center text-[11px] font-bold text-white shadow-xs">
              GF
            </div>
            <span className="font-bold tracking-tight text-base sm:text-lg uppercase text-white">
              GrowthForge
            </span>
          </div>

          <div className="h-4 w-[1px] bg-slate-700 shrink-0 hidden sm:block"></div>

          {/* Nav Items */}
          <div className="flex items-center gap-1 sm:gap-4 text-xs font-medium text-slate-400">
            {navItems.map((item) => {
              const isActive = activeView === item.id;
              return (
                <button
                  key={item.id}
                  id={`nav-tab-${item.id}`}
                  onClick={() => onViewChange(item.id)}
                  className={`px-2.5 py-4 transition-colors whitespace-nowrap cursor-pointer text-xs font-semibold uppercase tracking-wider ${
                    isActive
                      ? 'text-indigo-400 border-b-2 border-indigo-400'
                      : 'hover:text-white border-b-2 border-transparent'
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Status Badge: Architectural Lock / Supabase Active */}
        <div className="flex items-center gap-3 shrink-0">
          <div className="flex items-center gap-2 bg-emerald-500/10 px-3 py-1 rounded-full border border-emerald-500/20">
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
            <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-widest hidden sm:inline">
              Architectural Lock Active
            </span>
            <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-widest sm:hidden">
              Lock Active
            </span>
          </div>
        </div>
      </nav>

      {/* Sub-header Workspace Breadcrumb & Telemetry Bar */}
      <div className="h-11 border-b border-slate-200 flex items-center justify-between px-4 sm:px-8 text-xs font-medium text-slate-500 bg-slate-50">
        <div className="flex items-center gap-2 truncate">
          <span className="text-slate-400">Workspace</span>
          <span className="text-slate-300">/</span>
          <span className="text-slate-700 font-mono text-[11px] font-semibold truncate">
            {viewNameMap[activeView] || 'Architecture_Contract_v1.0.4'}
          </span>
        </div>

        {/* Live Counters */}
        <div className="flex items-center gap-3 sm:gap-4 text-[11px]">
          <div className="hidden lg:flex items-center gap-1.5 text-slate-500">
            <Database className="w-3.5 h-3.5 text-slate-400" />
            <span className="font-mono">{isSupabaseConfigured ? 'Supabase: Connected' : 'Supabase: Dual-Mode Seed'}</span>
          </div>

          <div className="flex items-center gap-2.5 pl-2 sm:border-l border-slate-200">
            <span className="text-slate-600 font-mono font-medium">
              Leads: <strong className="text-slate-900">{leadCounts.total}</strong>
            </span>
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-rose-50 text-rose-700 border border-rose-200 font-bold font-mono text-[10px]">
              HOT {leadCounts.hot}
            </span>
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200 font-bold font-mono text-[10px]">
              WARM {leadCounts.warm}
            </span>
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-200 text-slate-700 font-bold font-mono text-[10px]">
              NURTURE {leadCounts.nurture}
            </span>
          </div>
        </div>
      </div>
    </header>
  );
};
