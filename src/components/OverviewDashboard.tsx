import React, { useState, useEffect, useMemo } from 'react';
import {
  Activity,
  Users,
  Flame,
  Clock,
  CheckCircle,
  Building,
  TrendingUp,
  AlertTriangle,
  RotateCw
} from 'lucide-react';
import { GFBuyerLead } from '../types/buyerLead';
import { DbBrokerHandoff } from '../../app/schemas/database';
import { leadRepository } from '../services/supabase/repositories/leadRepository';
import { supabaseDataService } from '../../app/services/supabase/repositories';
import { calculateBrokerKPIs } from '../services/brokerDashboardService';
import { DEFAULT_TENANT_ID } from '../../app/schemas/tenant';

interface OverviewDashboardProps {
  onNavigate: (view: string) => void;
}

export const OverviewDashboard: React.FC<OverviewDashboardProps> = ({ onNavigate }) => {
  const [leads, setLeads] = useState<GFBuyerLead[]>([]);
  const [handoffsMap, setHandoffsMap] = useState<Map<string, DbBrokerHandoff>>(new Map());
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const allLeads = await leadRepository.getAllCanonicalLeads();
      setLeads(allLeads);

      const hMap = new Map<string, DbBrokerHandoff>();
      for (const lead of allLeads) {
        try {
          const handoffList = await supabaseDataService.brokerHandoffs.getHandoffsByLeadId(
            DEFAULT_TENANT_ID,
            lead.lead_id
          );
          if (handoffList && handoffList.length > 0) {
            hMap.set(lead.lead_id, handoffList[handoffList.length - 1]);
          }
        } catch {
          // Ignore individual lead query errors
        }
      }
      setHandoffsMap(hMap);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load dashboard data');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const kpis = useMemo(() => {
    return calculateBrokerKPIs(leads, Array.from(handoffsMap.values()));
  }, [leads, handoffsMap]);

  const totalLeads = leads.length;
  const slaAdherence = 94; // Mock for now

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-slate-900">
            Workspace Overview
          </h2>
          <p className="text-sm text-slate-600 mt-1">
            Real-time commercial intelligence and pipeline performance.
          </p>
        </div>
        <button
          onClick={loadData}
          disabled={isLoading}
          className="inline-flex items-center space-x-2 px-3 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 shadow-sm"
        >
          <RotateCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          <span>Refresh Metrics</span>
        </button>
      </div>

      {error && (
        <div className="bg-rose-50 border border-rose-200 rounded-xl p-4 flex items-start space-x-3 text-rose-800">
          <AlertTriangle className="w-5 h-5 text-rose-600 mt-0.5 shrink-0" />
          <p className="text-sm font-medium">{error}</p>
        </div>
      )}

      {/* Top Metrics Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
          <div className="flex items-center justify-between pb-4">
            <span className="text-sm font-medium text-slate-500 uppercase tracking-wider">Total Pipeline</span>
            <Users className="w-5 h-5 text-indigo-500" />
          </div>
          <div className="text-3xl font-bold text-slate-900">{totalLeads}</div>
          <div className="mt-2 text-xs font-medium text-emerald-600 flex items-center gap-1">
            <TrendingUp className="w-3.5 h-3.5" />
            <span>+12% vs last week</span>
          </div>
        </div>

        <div className="bg-white border border-rose-200 rounded-xl p-6 shadow-sm shadow-rose-100/50">
          <div className="flex items-center justify-between pb-4">
            <span className="text-sm font-medium text-slate-500 uppercase tracking-wider">Hot Prospects</span>
            <Flame className="w-5 h-5 text-rose-500" />
          </div>
          <div className="text-3xl font-bold text-slate-900">{kpis.hotCount}</div>
          <div className="mt-2 text-xs font-medium text-rose-600 flex items-center gap-1">
            <AlertTriangle className="w-3.5 h-3.5" />
            <span>{kpis.needsActionCount} require action</span>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
          <div className="flex items-center justify-between pb-4">
            <span className="text-sm font-medium text-slate-500 uppercase tracking-wider">SLA Adherence</span>
            <Clock className="w-5 h-5 text-emerald-500" />
          </div>
          <div className="text-3xl font-bold text-slate-900">{slaAdherence}%</div>
          <div className="mt-2 text-xs font-medium text-emerald-600 flex items-center gap-1">
            <CheckCircle className="w-3.5 h-3.5" />
            <span>Target: 90%</span>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
          <div className="flex items-center justify-between pb-4">
            <span className="text-sm font-medium text-slate-500 uppercase tracking-wider">Project Fits</span>
            <Building className="w-5 h-5 text-indigo-500" />
          </div>
          <div className="text-3xl font-bold text-slate-900">{kpis.projectMatchedCount}</div>
          <div className="mt-2 text-xs font-medium text-slate-500 flex items-center gap-1">
            <span>Buyers with matched inventory</span>
          </div>
        </div>
      </div>

      {/* Action Areas */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
          <h3 className="text-lg font-bold text-slate-900 mb-4">Action Required</h3>
          <p className="text-sm text-slate-600 mb-6 leading-relaxed">
            There are {kpis.needsActionCount} leads awaiting review or action in your priority queue. 
            Ensure SLA deadlines are met for HOT and WARM buyers.
          </p>
          <button 
            onClick={() => onNavigate('priority-queue')}
            className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-bold transition-colors shadow-sm"
          >
            OPEN PRIORITY QUEUE
          </button>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm flex flex-col justify-between">
          <div>
            <h3 className="text-lg font-bold text-slate-900 mb-4">Pending Handoffs</h3>
            <p className="text-sm text-slate-600 mb-6 leading-relaxed">
              {kpis.handoffPendingCount} buyer profiles have been qualified and are awaiting 
              sales handoff and CRM dispatch.
            </p>
          </div>
          <button 
            onClick={() => onNavigate('buyers')}
            className="w-full py-2.5 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-lg text-sm font-bold transition-colors"
          >
            VIEW ALL BUYERS
          </button>
        </div>
      </div>
    </div>
  );
};
