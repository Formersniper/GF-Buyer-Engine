/**
 * GrowthForge Buyer Intelligence Engine
 * Phase 1 Application Shell & View Router
 */

import React, { useState, useEffect } from 'react';
import { Header } from './components/Header';
import { QualifiedBuyersView } from './components/QualifiedBuyersView';
import { BuyerDetailView } from './components/BuyerDetailView';
import { ProjectMatchesView } from './components/ProjectMatchesView';
import { OverviewDashboard } from './components/OverviewDashboard';
import { PriorityQueueView } from './components/PriorityQueueView';
import { GFBuyerLead } from './types/buyerLead';
import { leadRepository } from './services/supabase/repositories/leadRepository';

export default function App() {
  const [activeView, setActiveView] = useState<string>('overview');
  const [leads, setLeads] = useState<GFBuyerLead[]>([]);
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);

  // Load canonical leads from repository on mount
  useEffect(() => {
    async function loadLeads() {
      const all = await leadRepository.getAllCanonicalLeads();
      setLeads(all);
    }
    loadLeads();
  }, []);

  const handleSelectLead = (leadId: string) => {
    setSelectedLeadId(leadId);
    setActiveView('buyer-detail');
  };

  const selectedLead = leads.find((l) => l.lead_id === selectedLeadId) || leads[0] || null;

  const leadCounts = {
    total: leads.length,
    hot: leads.filter((l) => l.lead_intelligence.qualification === 'HOT' || l.workflow.status === 'HOT').length,
    warm: leads.filter((l) => l.lead_intelligence.qualification === 'WARM' || l.workflow.status === 'WARM').length,
    nurture: leads.filter((l) => l.lead_intelligence.qualification === 'NURTURE' || l.workflow.status === 'NURTURE').length,
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col font-sans selection:bg-indigo-100 selection:text-indigo-900">
      <Header
        activeView={activeView}
        onViewChange={(view) => {
          setActiveView(view);
        }}
        leadCounts={leadCounts}
      />

      <main className="flex-1 bg-slate-50">
        {activeView === 'overview' && (
          <OverviewDashboard onNavigate={setActiveView} />
        )}

        {activeView === 'priority-queue' && (
          <PriorityQueueView onSelectLead={handleSelectLead} />
        )}

        {activeView === 'buyers' && (
          <QualifiedBuyersView leads={leads} onSelectLead={handleSelectLead} />
        )}

        {activeView === 'buyer-detail' && (
          selectedLead ? (
            <BuyerDetailView lead={selectedLead} onBack={() => setActiveView('priority-queue')} />
          ) : (
            <div className="max-w-md mx-auto py-16 text-center text-slate-500">
              No lead selected. Please choose a lead from the Priority Queue or All Buyers.
            </div>
          )
        )}

        {activeView === 'matches' && (
          <ProjectMatchesView leads={leads} onSelectLead={handleSelectLead} />
        )}
      </main>

      {/* Technical Telemetry Footer (Professional Polish Theme) */}
      <footer className="h-8 bg-slate-100 border-t border-slate-200 px-4 sm:px-8 flex items-center justify-between shrink-0 text-[10px] font-mono text-slate-500 uppercase tracking-widest">
        <div className="flex items-center gap-4 sm:gap-6">
          <span className="hidden sm:inline">ENGINE: GROWTHFORGE-V1</span>
          <span>LATENCY: 4ms</span>
          <span>SYSTEM OF RECORD: SUPABASE</span>
          <span className="hidden md:inline">AI: GEMINI</span>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-indigo-600 font-bold flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-indigo-600"></span>
            SYSTEM STABLE
          </span>
          <span className="hidden sm:inline">BUILD V4921-PHASE1</span>
        </div>
      </footer>
    </div>
  );
}
