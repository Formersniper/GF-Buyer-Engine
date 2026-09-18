import React, { useState, useEffect, useMemo } from 'react';
import {
  Flame,
  SunMedium,
  Leaf,
  ArrowRight,
  Clock,
  AlertTriangle,
  Building,
  MapPin,
  Tag,
  CheckCircle2,
  RotateCw,
  Filter
} from 'lucide-react';
import { GFBuyerLead } from '../types/buyerLead';
import { DbBrokerHandoff } from '../../app/schemas/database';
import { leadRepository } from '../services/supabase/repositories/leadRepository';
import { supabaseDataService } from '../../app/services/supabase/repositories';
import {
  filterAndSortPriorityQueue,
  DashboardFilters
} from '../services/brokerDashboardService';
import { DEFAULT_TENANT_ID } from '../../app/schemas/tenant';

interface PriorityQueueViewProps {
  onSelectLead: (leadId: string) => void;
}

export const PriorityQueueView: React.FC<PriorityQueueViewProps> = ({ onSelectLead }) => {
  const [leads, setLeads] = useState<GFBuyerLead[]>([]);
  const [handoffsMap, setHandoffsMap] = useState<Map<string, DbBrokerHandoff>>(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [filters, setFilters] = useState<DashboardFilters>({
    temperature: 'ALL',
    qualification: 'ALL',
    propertyType: 'ALL',
    budgetRange: 'ALL',
    preferredLocation: '',
    timeline: '',
    projectMatch: 'ALL',
    handoffStatus: 'ALL',
    searchQuery: '',
  });

  const loadData = async () => {
    try {
      if (leads.length > 0) setIsRefreshing(true);
      else setIsLoading(true);
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
      setError(err instanceof Error ? err.message : 'Failed to load priority queue data');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const priorityQueue = useMemo(() => {
    return filterAndSortPriorityQueue(leads, handoffsMap, filters);
  }, [leads, handoffsMap, filters]);

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (filters.temperature !== 'ALL') count++;
    if (filters.qualification !== 'ALL') count++;
    if (filters.propertyType !== 'ALL') count++;
    if (filters.budgetRange !== 'ALL') count++;
    if (filters.preferredLocation?.trim()) count++;
    if (filters.timeline?.trim()) count++;
    if (filters.projectMatch !== 'ALL') count++;
    if (filters.handoffStatus !== 'ALL') count++;
    if (filters.searchQuery?.trim()) count++;
    return count;
  }, [filters]);

  const resetFilters = () => {
    setFilters({
      temperature: 'ALL',
      qualification: 'ALL',
      propertyType: 'ALL',
      budgetRange: 'ALL',
      preferredLocation: '',
      timeline: '',
      projectMatch: 'ALL',
      handoffStatus: 'ALL',
      searchQuery: '',
    });
  };

  const formatCurrency = (amount: number | null | undefined): string => {
    if (amount === null || amount === undefined || amount === 0) return 'Undisclosed';
    if (amount >= 10000000) {
      return `₹${(amount / 10000000).toFixed(1)} Cr`;
    }
    if (amount >= 100000) {
      return `₹${(amount / 100000).toFixed(0)} Lakh`;
    }
    return `₹${amount.toLocaleString('en-IN')}`;
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-slate-900">
            SLA Priority Queue
          </h2>
          <p className="text-sm text-slate-600 mt-1">
            Buyers deterministically ordered by intent score, SLA urgency, and commercial readiness.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={loadData}
            disabled={isRefreshing || isLoading}
            className="inline-flex items-center space-x-2 px-3 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 shadow-sm"
          >
            <RotateCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-rose-50 border border-rose-200 rounded-xl p-4 flex items-start space-x-3 text-rose-800">
          <AlertTriangle className="w-5 h-5 text-rose-600 mt-0.5 shrink-0" />
          <p className="text-sm font-medium">{error}</p>
        </div>
      )}

      {/* SLA Priority Queue Matrix */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
        <div className="p-4 border-b border-slate-200 bg-slate-50/50 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center space-x-2">
            <h3 className="font-semibold text-slate-900 flex items-center gap-2">
              Action Queue
              <span className="px-2 py-0.5 bg-indigo-100 text-indigo-700 rounded-full text-xs font-bold">
                {priorityQueue.length}
              </span>
            </h3>
          </div>

          <div className="flex items-center space-x-2">
            <div className="relative">
              <input
                type="text"
                placeholder="Search name, phone..."
                value={filters.searchQuery}
                onChange={(e) => setFilters({ ...filters, searchQuery: e.target.value })}
                className="w-full sm:w-64 pl-3 pr-4 py-1.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-shadow"
              />
            </div>
            
            <div className="flex items-center bg-slate-100 rounded-lg p-0.5 border border-slate-200">
              {(['ALL', 'HOT', 'WARM', 'NURTURE'] as const).map((temp) => (
                <button
                  key={temp}
                  onClick={() => setFilters({ ...filters, temperature: temp })}
                  className={`px-3 py-1.5 text-xs font-semibold uppercase tracking-wider rounded-md transition-all ${
                    filters.temperature === temp
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  {temp}
                </button>
              ))}
            </div>

            {activeFilterCount > (filters.temperature !== 'ALL' ? 1 : 0) && (
              <button
                onClick={resetFilters}
                className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-md transition-colors"
                title="Reset Filters"
              >
                <Filter className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* List View */}
        <div className="divide-y divide-slate-100">
          {isLoading ? (
            <div className="p-8 text-center text-slate-500">Loading priority queue...</div>
          ) : priorityQueue.length === 0 ? (
            <div className="p-12 text-center">
              <CheckCircle2 className="w-12 h-12 text-emerald-400 mx-auto mb-3" />
              <h3 className="text-sm font-semibold text-slate-900">Queue Cleared</h3>
              <p className="text-xs text-slate-500 mt-1">
                No buyers match the current criteria or require immediate action.
              </p>
            </div>
          ) : (
            priorityQueue.map((item, index) => {
              const qual = item.lead.lead_intelligence.qualification.toUpperCase();
              const wStatus = item.lead.workflow.status.toUpperCase();
              const scoreBand = qual === 'HOT' || wStatus === 'HOT' ? 'HOT' : qual === 'WARM' || wStatus === 'WARM' ? 'WARM' : 'NURTURE';
              const intentScore = item.lead.lead_intelligence.intent_score;
              const matches = item.lead.project_intelligence?.top_matches || [];
              const handoffStatus = item.handoff?.handoff_status || (wStatus === 'HANDED_OFF' ? 'COMPLETED' : 'NOT_STARTED');

              return (
                <div
                  key={item.lead.lead_id}
                  onClick={() => onSelectLead(item.lead.lead_id)}
                  className="p-4 hover:bg-slate-50 transition-colors cursor-pointer group flex flex-col sm:flex-row gap-4"
                >
                  <div className="shrink-0 flex flex-col items-center justify-center w-12 sm:w-16">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Rank</span>
                    <div className="w-8 h-8 rounded-full bg-slate-100 text-slate-700 font-bold flex items-center justify-center text-sm border border-slate-200">
                      #{index + 1}
                    </div>
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center space-x-2">
                        <h4 className="font-bold text-slate-900 truncate">
                          {item.lead.identity.full_name}
                        </h4>
                        
                        {scoreBand === 'HOT' && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-rose-100 text-rose-700 border border-rose-200">
                            <Flame className="w-3 h-3 text-rose-600" />
                            <span>HOT {intentScore > 0 ? `(${intentScore})` : ''}</span>
                          </span>
                        )}
                        {scoreBand === 'WARM' && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-amber-100 text-amber-700 border border-amber-200">
                            <SunMedium className="w-3 h-3 text-amber-600" />
                            <span>WARM {intentScore > 0 ? `(${intentScore})` : ''}</span>
                          </span>
                        )}
                        {scoreBand === 'NURTURE' && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-indigo-50 text-indigo-700 border border-indigo-200">
                            <Leaf className="w-3 h-3 text-indigo-600" />
                            <span>NURTURE {intentScore > 0 ? `(${intentScore})` : ''}</span>
                          </span>
                        )}
                      </div>
                      
                      <div className="hidden sm:flex items-center space-x-2 text-xs">
                        <span className="text-slate-500 font-mono">{item.lead.identity.phone}</span>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-y-2 gap-x-4 mt-2">
                      <div className="flex items-center gap-1.5 text-xs text-slate-600">
                        <Building className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        <span className="truncate" title={item.lead.buying_intent.property_type}>
                          {item.lead.buying_intent.property_type || 'Unknown Type'}
                          {item.lead.buying_intent.configuration ? ` • ${item.lead.buying_intent.configuration}` : ''}
                        </span>
                      </div>
                      
                      <div className="flex items-center gap-1.5 text-xs text-slate-600">
                        <Tag className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        <span className="font-mono">
                          {formatCurrency(item.lead.buying_intent.budget.min)} - {formatCurrency(item.lead.buying_intent.budget.max)}
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5 text-xs text-slate-600">
                        <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        <span className="truncate">
                          {item.lead.buying_intent.preferred_locations.length > 0 
                            ? item.lead.buying_intent.preferred_locations.join(', ')
                            : 'No locations specified'}
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5 text-xs">
                        <Clock className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        <span className={`font-semibold truncate ${
                          item.sla.urgency === 'CRITICAL' ? 'text-rose-600' :
                          item.sla.urgency === 'HIGH' ? 'text-amber-600' :
                          'text-slate-600'
                        }`}>
                          {item.sla.action}
                        </span>
                      </div>
                    </div>
                    
                    {matches.length > 0 && (
                      <div className="mt-3 flex items-center gap-2">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                          {matches.length} Project Matches
                        </span>
                        <div className="flex flex-wrap gap-1">
                          {matches.slice(0, 2).map((m) => (
                            <span key={m.project_id} className="px-1.5 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded text-[10px] font-medium truncate max-w-[120px]">
                              {m.project_name}
                            </span>
                          ))}
                          {matches.length > 2 && (
                            <span className="px-1.5 py-0.5 bg-slate-100 text-slate-600 border border-slate-200 rounded text-[10px] font-medium">
                              +{matches.length - 2} more
                            </span>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                  
                  <div className="shrink-0 flex items-center justify-end sm:w-24">
                     <ArrowRight className="w-5 h-5 text-slate-300 group-hover:text-indigo-600 transition-colors" />
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
