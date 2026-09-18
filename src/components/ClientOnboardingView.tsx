import React, { useState, useEffect } from 'react';
import { Settings, Database, Webhook, FileUp, Folder, ArrowRight, ExternalLink } from 'lucide-react';
import { supabaseDataService } from '../../app/services/supabase/repositories';
import { DEFAULT_TENANT_ID } from '../../app/schemas/tenant';

interface ClientOnboardingViewProps {
  onComplete?: () => void;
}

export const ClientOnboardingView: React.FC<ClientOnboardingViewProps> = ({ onComplete }) => {
  const [activeTab, setActiveTab] = useState<'projects' | 'intake' | 'crm'>('projects');

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-8 animate-in fade-in duration-500">
      <header className="mb-8">
        <div className="flex items-center gap-3 text-indigo-600 mb-2">
          <Settings className="w-5 h-5" />
          <h2 className="text-sm font-bold tracking-widest uppercase">Client Onboarding</h2>
        </div>
        <h1 className="text-3xl font-bold text-slate-900 tracking-tight">
          Workspace Configuration
        </h1>
        <p className="text-slate-500 mt-2 max-w-2xl text-sm leading-relaxed">
          Configure your inventory, connect your lead sources, and set up your CRM destination to activate the GrowthForge Buyer Intelligence Engine.
        </p>
      </header>

      <div className="flex items-center gap-6 border-b border-slate-200">
        <button
          onClick={() => setActiveTab('projects')}
          className={`pb-4 text-sm font-bold uppercase tracking-wider transition-colors border-b-2 ${
            activeTab === 'projects' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          1. Projects / Inventory
        </button>
        <button
          onClick={() => setActiveTab('intake')}
          className={`pb-4 text-sm font-bold uppercase tracking-wider transition-colors border-b-2 ${
            activeTab === 'intake' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          2. Lead Intake
        </button>
        <button
          onClick={() => setActiveTab('crm')}
          className={`pb-4 text-sm font-bold uppercase tracking-wider transition-colors border-b-2 ${
            activeTab === 'crm' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          3. CRM Destination
        </button>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-8 min-h-[500px]">
        {activeTab === 'projects' && (
          <div className="space-y-6">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-lg font-bold text-slate-900">Project Inventory</h3>
                <p className="text-sm text-slate-500 mt-1">
                  Define the primary real estate developments or projects your brokerage is selling.
                  GrowthForge uses this data to match buyers based on their extracted preferences.
                </p>
              </div>
              <button className="px-4 py-2 bg-indigo-600 text-white text-sm font-bold rounded shadow-sm hover:bg-indigo-700 transition-colors">
                + Add Project
              </button>
            </div>
            
            <div className="p-12 text-center border-2 border-dashed border-slate-200 rounded-lg">
              <Folder className="w-8 h-8 text-slate-400 mx-auto mb-3" />
              <p className="text-slate-500 text-sm">No projects configured yet.</p>
            </div>
            
            <div className="flex justify-end mt-8">
               <button onClick={() => setActiveTab('intake')} className="flex items-center gap-2 text-indigo-600 font-bold hover:text-indigo-700 text-sm uppercase tracking-wider">
                 Next Step <ArrowRight className="w-4 h-4" />
               </button>
            </div>
          </div>
        )}

        {activeTab === 'intake' && (
          <div className="space-y-8">
            <header>
              <h3 className="text-lg font-bold text-slate-900">Lead Intake Configuration</h3>
              <p className="text-sm text-slate-500 mt-1">
                GrowthForge supports real-time inbound API webhooks or bulk CSV ingestion.
              </p>
            </header>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="border border-slate-200 rounded-lg p-6 flex flex-col items-start bg-slate-50/50">
                <div className="w-10 h-10 bg-indigo-100 rounded-lg flex items-center justify-center text-indigo-600 mb-4">
                  <Webhook className="w-5 h-5" />
                </div>
                <h4 className="text-base font-bold text-slate-900 mb-2">Real-Time Webhook</h4>
                <p className="text-sm text-slate-500 mb-4 flex-1">
                  Connect your top-of-funnel (Facebook Ads, landing pages) directly via our REST API. Webhooks are idempotent and secure.
                </p>
                <div className="w-full bg-slate-900 p-3 rounded-md text-[11px] font-mono text-emerald-400 break-all mb-4">
                  POST /api/leads/webhook<br />
                  Authorization: Bearer [API_KEY]
                </div>
                <button className="px-4 py-2 bg-white border border-slate-300 text-slate-700 text-sm font-bold rounded shadow-sm hover:bg-slate-50 transition-colors w-full">
                  Generate API Key
                </button>
              </div>

              <div className="border border-slate-200 rounded-lg p-6 flex flex-col items-start bg-slate-50/50">
                <div className="w-10 h-10 bg-emerald-100 rounded-lg flex items-center justify-center text-emerald-600 mb-4">
                  <FileUp className="w-5 h-5" />
                </div>
                <h4 className="text-base font-bold text-slate-900 mb-2">Bulk CSV Import</h4>
                <p className="text-sm text-slate-500 mb-4 flex-1">
                  Upload an existing list of raw leads. GrowthForge will automatically resolve and deduplicate records.
                </p>
                <div className="mt-auto w-full">
                  <button className="px-4 py-2 bg-emerald-600 text-white text-sm font-bold rounded shadow-sm hover:bg-emerald-700 transition-colors w-full">
                    Upload CSV File
                  </button>
                </div>
              </div>
            </div>
            
            <div className="flex justify-between mt-8 pt-6 border-t border-slate-100">
               <button onClick={() => setActiveTab('projects')} className="text-slate-500 font-bold hover:text-slate-700 text-sm uppercase tracking-wider">
                 Previous
               </button>
               <button onClick={() => setActiveTab('crm')} className="flex items-center gap-2 text-indigo-600 font-bold hover:text-indigo-700 text-sm uppercase tracking-wider">
                 Next Step <ArrowRight className="w-4 h-4" />
               </button>
            </div>
          </div>
        )}

        {activeTab === 'crm' && (
          <div className="space-y-6">
            <header>
              <h3 className="text-lg font-bold text-slate-900">CRM Destination</h3>
              <p className="text-sm text-slate-500 mt-1">
                Configure where qualified buyers and dossier transcripts should be dispatched.
              </p>
            </header>

            <div className="max-w-xl space-y-4">
              <div className="p-4 border border-indigo-100 bg-indigo-50/50 rounded-lg flex items-start gap-4">
                <Database className="w-5 h-5 text-indigo-600 mt-0.5 shrink-0" />
                <div>
                  <h4 className="text-sm font-bold text-slate-900">Salesforce / FollowUpBoss</h4>
                  <p className="text-xs text-slate-600 mt-1">
                    Direct integration is currently configured via our secure dispatch queue.
                  </p>
                  <button className="mt-3 flex items-center gap-1.5 text-xs font-bold text-indigo-600 uppercase tracking-widest hover:text-indigo-700">
                    Configure Webhook <ExternalLink className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>

            <div className="flex justify-between mt-8 pt-6 border-t border-slate-100">
               <button onClick={() => setActiveTab('intake')} className="text-slate-500 font-bold hover:text-slate-700 text-sm uppercase tracking-wider">
                 Previous
               </button>
               <button onClick={onComplete} className="px-6 py-2 bg-slate-900 text-white text-sm font-bold uppercase tracking-wider rounded shadow-sm hover:bg-slate-800 transition-colors">
                 Complete Setup
               </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
