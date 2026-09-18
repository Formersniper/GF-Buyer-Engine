/**
 * GrowthForge Buyer Intelligence Engine - Voice Activation Queue View
 *
 * PHASE 9.3.4 OPERATOR WORKSPACE:
 * - Tenant-scoped, deterministically ordered actionable voice leads.
 * - Displays eligibility, compliance, attempt count, buyer score, tier, and SLA urgency.
 * - Authoritative activation action invoking POST /api/voice/activate to transition leads to CALL_PENDING.
 * - Strictly communicates via authenticated HTTP API (no direct repository or service imports).
 */

import React, { useState, useEffect } from 'react';
import {
  PhoneCall,
  Clock,
  AlertCircle,
  CheckCircle2,
  RotateCw,
  Search,
  Filter,
  Flame,
  ShieldAlert,
  ArrowRight,
  UserCheck
} from 'lucide-react';

interface VoiceQueueItem {
  lead_id: string;
  internal_id: string;
  buyer_name: string;
  phone: string | null;
  source: string | null;
  workflow_status: string;
  eligibility_decision: 'ELIGIBLE' | 'NOT_ELIGIBLE' | 'REQUIRES_REVIEW';
  eligibility_reasons: string[];
  next_eligible_at: string | null;
  attempt_count: number;
  last_attempt_at: string | null;
  last_call_status: string | null;
  buyer_score: number;
  buyer_tier: string;
  sla_deadline: string | null;
  urgency: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  created_at: string;
}

interface VoiceActivationQueueViewProps {
  onSelectLead: (leadId: string) => void;
}

export const VoiceActivationQueueView: React.FC<VoiceActivationQueueViewProps> = ({ onSelectLead }) => {
  const [items, setItems] = useState<VoiceQueueItem[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [activatingLeadId, setActivatingLeadId] = useState<string | null>(null);

  const [tierFilter, setTierFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');

  const fetchQueue = async (refresh = false) => {
    try {
      if (refresh) setIsRefreshing(true);
      else setIsLoading(true);
      setError(null);

      const params = new URLSearchParams();
      if (tierFilter !== 'ALL') params.append('tier', tierFilter);
      if (searchQuery.trim()) params.append('search', searchQuery.trim());

      const res = await fetch(`/api/voice/queue?${params.toString()}`, {
        headers: {
          'Authorization': 'Bearer gf-operator-token',
        },
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `Failed to fetch queue (${res.status})`);
      }

      const data = await res.json();
      setItems(data.items || []);
      setTotal(data.total || 0);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load voice activation queue');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    fetchQueue();
  }, [tierFilter]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    fetchQueue(true);
  };

  const handleActivate = async (leadId: string, buyerName: string) => {
    try {
      setActivatingLeadId(leadId);
      setActionMessage(null);
      setError(null);

      const res = await fetch('/api/voice/activate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer gf-operator-token',
        },
        body: JSON.stringify({ leadId }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || data.reasons?.[0] || 'Lead activation failed');
      }

      setActionMessage(`Successfully activated "${buyerName}" into CALL_PENDING.`);
      // Refresh queue
      await fetchQueue(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Activation error');
    } finally {
      setActivatingLeadId(null);
    }
  };

  const getUrgencyBadge = (urgency: string) => {
    switch (urgency) {
      case 'CRITICAL':
        return <span className="px-2 py-0.5 text-xs font-semibold bg-rose-100 text-rose-800 rounded-full border border-rose-200">Critical SLA</span>;
      case 'HIGH':
        return <span className="px-2 py-0.5 text-xs font-semibold bg-amber-100 text-amber-800 rounded-full border border-amber-200">High Priority</span>;
      case 'MEDIUM':
        return <span className="px-2 py-0.5 text-xs font-semibold bg-blue-100 text-blue-800 rounded-full border border-blue-200">Medium</span>;
      default:
        return <span className="px-2 py-0.5 text-xs font-semibold bg-slate-100 text-slate-700 rounded-full border border-slate-200">Standard</span>;
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 py-8 space-y-6">
      {/* Header Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
        <div>
          <div className="flex items-center space-x-3">
            <div className="p-3 bg-indigo-50 text-indigo-600 rounded-xl">
              <PhoneCall className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Voice Activation Queue</h1>
              <p className="text-sm text-slate-600 mt-0.5">
                Actionable pre-call pipeline for sales operators. Guaranteed compliant & eligible leads ready for activation.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center space-x-3">
          <button
            onClick={() => fetchQueue(true)}
            disabled={isRefreshing}
            className="inline-flex items-center px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-xl hover:bg-slate-50 transition-colors shadow-sm disabled:opacity-50"
          >
            <RotateCw className={`w-4 h-4 mr-2 ${isRefreshing ? 'animate-spin' : ''}`} />
            Refresh Queue
          </button>
        </div>
      </div>

      {/* Action / Error Banners */}
      {actionMessage && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-800 text-sm flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0" />
            <span>{actionMessage}</span>
          </div>
          <button onClick={() => setActionMessage(null)} className="text-emerald-600 hover:text-emerald-800 font-semibold text-xs">Dismiss</button>
        </div>
      )}

      {error && (
        <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-sm flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <AlertCircle className="w-5 h-5 text-rose-600 flex-shrink-0" />
            <span>{error}</span>
          </div>
          <button onClick={() => setError(null)} className="text-rose-600 hover:text-rose-800 font-semibold text-xs">Dismiss</button>
        </div>
      )}

      {/* Filters & Search Toolbar */}
      <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-200 flex flex-col md:flex-row items-center justify-between gap-4">
        <form onSubmit={handleSearchSubmit} className="relative w-full md:w-96">
          <Search className="absolute left-3.5 top-3 w-4 h-4 text-slate-400" />
          <input
            type="text"
            placeholder="Search by buyer name, phone, lead ID..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white transition-all"
          />
        </form>

        <div className="flex items-center space-x-3 w-full md:w-auto justify-end">
          <div className="flex items-center space-x-2">
            <Filter className="w-4 h-4 text-slate-500" />
            <span className="text-xs font-semibold text-slate-600 uppercase tracking-wider">Tier Filter:</span>
          </div>
          <select
            value={tierFilter}
            onChange={(e) => setTierFilter(e.target.value)}
            className="px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 text-slate-700"
          >
            <option value="ALL">All Tiers ({total})</option>
            <option value="TIER_1_HOT">Tier 1 Hot</option>
            <option value="TIER_2_WARM">Tier 2 Warm</option>
            <option value="TIER_3_NURTURE">Tier 3 Nurture</option>
          </select>
        </div>
      </div>

      {/* Queue Table / Cards */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 bg-slate-50/50 flex items-center justify-between">
          <h2 className="text-sm font-bold text-slate-800 uppercase tracking-wider">
            Actionable Voice Leads ({total})
          </h2>
          <span className="text-xs text-slate-500">Deterministically ordered by SLA & Intent</span>
        </div>

        {isLoading ? (
          <div className="p-12 text-center text-slate-500">
            <RotateCw className="w-6 h-6 animate-spin mx-auto mb-3 text-indigo-600" />
            <p className="text-sm font-medium">Loading voice activation queue...</p>
          </div>
        ) : items.length === 0 ? (
          <div className="p-16 text-center space-y-3">
            <div className="w-12 h-12 bg-slate-100 text-slate-400 rounded-full flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-6 h-6" />
            </div>
            <h3 className="text-base font-semibold text-slate-800">Queue is Clear</h3>
            <p className="text-sm text-slate-500 max-w-sm mx-auto">
              No actionable leads currently match your criteria. Inbound leads meeting eligibility and compliance rules will appear here automatically.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {items.map((item) => (
              <div key={item.internal_id} className="p-6 hover:bg-slate-50/80 transition-colors flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
                <div className="space-y-2 flex-1">
                  <div className="flex items-center space-x-3">
                    <button
                      onClick={() => onSelectLead(item.lead_id)}
                      className="text-base font-bold text-slate-900 hover:text-indigo-600 transition-colors text-left"
                    >
                      {item.buyer_name}
                    </button>
                    {getUrgencyBadge(item.urgency)}
                    <span className="px-2 py-0.5 text-xs font-semibold bg-indigo-50 text-indigo-700 rounded-full border border-indigo-100">
                      Score: {item.buyer_score}
                    </span>
                    <span className="px-2 py-0.5 text-xs font-medium bg-slate-100 text-slate-600 rounded-full">
                      {item.buyer_tier}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-4 text-xs text-slate-600">
                    <div className="flex items-center space-x-1.5 font-mono bg-slate-100 px-2 py-1 rounded-md text-slate-700">
                      <PhoneCall className="w-3.5 h-3.5 text-slate-400" />
                      <span>{item.phone || 'No Phone'}</span>
                    </div>
                    <div>
                      Source: <span className="font-medium text-slate-700">{item.source}</span>
                    </div>
                    <div>
                      Status: <span className="font-medium text-slate-700">{item.workflow_status}</span>
                    </div>
                    <div>
                      Attempts: <span className="font-medium text-slate-700">{item.attempt_count}</span>
                    </div>
                    {item.last_call_status && (
                      <div>
                        Last Call: <span className="font-medium text-slate-700">{item.last_call_status}</span>
                      </div>
                    )}
                  </div>

                  <p className="text-xs text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-lg inline-block border border-emerald-100">
                    ✓ {item.eligibility_reasons[0] || 'Eligible for outbound voice activation.'}
                  </p>
                </div>

                <div className="flex items-center space-x-3 w-full lg:w-auto justify-end">
                  <button
                    onClick={() => onSelectLead(item.lead_id)}
                    className="px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-xl hover:bg-slate-50 transition-colors"
                  >
                    View Dossier
                  </button>

                  <button
                    onClick={() => handleActivate(item.lead_id, item.buyer_name)}
                    disabled={activatingLeadId === item.internal_id || !item.phone}
                    className="inline-flex items-center px-4 py-2 text-xs font-semibold text-white bg-indigo-600 rounded-xl hover:bg-indigo-700 transition-colors shadow-sm disabled:opacity-50"
                  >
                    {activatingLeadId === item.internal_id ? (
                      <>
                        <RotateCw className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                        Activating...
                      </>
                    ) : (
                      <>
                        Activate Call
                        <ArrowRight className="w-3.5 h-3.5 ml-1.5" />
                      </>
                    )}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
