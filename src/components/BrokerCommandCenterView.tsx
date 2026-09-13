import React, { useState, useEffect, useMemo } from 'react';
import {
  Flame,
  SunMedium,
  Leaf,
  Search,
  RotateCw,
  Filter,
  CheckCircle2,
  Clock,
  AlertTriangle,
  X,
  ChevronRight,
  Building2,
  User,
  Phone,
  Mail,
  MapPin,
  Briefcase,
  DollarSign,
  Calendar,
  ShieldCheck,
  FileText,
  Sparkles,
  ExternalLink,
  Layers,
  ArrowUpRight,
  Info,
} from 'lucide-react';
import { GFBuyerLead } from '../types/buyerLead';
import { DbBrokerHandoff, Call, CallTranscript } from '../../app/schemas/database';
import { leadRepository } from '../services/supabase/repositories/leadRepository';
import { supabaseDataService } from '../../app/services/supabase/repositories';
import {
  calculateBrokerKPIs,
  getRecommendedActionAndSLA,
  filterAndSortPriorityQueue,
  DashboardFilters,
  BrokerDashboardKPIs,
} from '../services/brokerDashboardService';
import { DEFAULT_TENANT_ID } from '../../app/schemas/tenant';

interface BrokerCommandCenterViewProps {
  onSelectLead?: (lead: GFBuyerLead) => void;
}

export const BrokerCommandCenterView: React.FC<BrokerCommandCenterViewProps> = ({
  onSelectLead,
}) => {
  const [leads, setLeads] = useState<GFBuyerLead[]>([]);
  const [handoffsMap, setHandoffsMap] = useState<Map<string, DbBrokerHandoff>>(new Map());
  const [callsMap, setCallsMap] = useState<Map<string, Call>>(new Map());
  const [transcriptsMap, setTranscriptsMap] = useState<Map<string, CallTranscript>>(new Map());

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Selected Lead for Snapshot Drawer
  const [selectedLead, setSelectedLead] = useState<GFBuyerLead | null>(null);
  const [showTranscriptDetails, setShowTranscriptDetails] = useState<boolean>(false);

  // Filters State
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

  // Load Data
  const loadDashboardData = async () => {
    try {
      setIsRefreshing(true);
      setError(null);

      // 1. Fetch canonical leads
      const allLeads = await leadRepository.getAllCanonicalLeads();
      setLeads(allLeads);

      // 2. Fetch handoffs, calls, transcripts for enriched state
      const hMap = new Map<string, DbBrokerHandoff>();
      const cMap = new Map<string, Call>();
      const tMap = new Map<string, CallTranscript>();

      for (const lead of allLeads) {
        try {
          const handoffList = await supabaseDataService.brokerHandoffs.getHandoffsByLeadId(
            DEFAULT_TENANT_ID,
            lead.lead_id
          );
          if (handoffList && handoffList.length > 0) {
            hMap.set(lead.lead_id, handoffList[handoffList.length - 1]);
          }

          const callList = await supabaseDataService.calls.getCallsByLead(
            DEFAULT_TENANT_ID,
            lead.lead_id
          );
          if (callList && callList.length > 0) {
            const latestCall = callList[callList.length - 1];
            cMap.set(lead.lead_id, latestCall);

            const tx = await supabaseDataService.transcripts.getTranscriptByCallId(
              DEFAULT_TENANT_ID,
              latestCall.id
            );
            if (tx) {
              tMap.set(lead.lead_id, tx);
            }
          }
        } catch {
          // Ignore individual lead query errors in preview fallback
        }
      }

      setHandoffsMap(hMap);
      setCallsMap(cMap);
      setTranscriptsMap(tMap);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load broker workspace data';
      setError(msg);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    loadDashboardData();
  }, []);

  // KPIs
  const kpis: BrokerDashboardKPIs = useMemo(() => {
    const handoffArray = Array.from(handoffsMap.values()) as DbBrokerHandoff[];
    return calculateBrokerKPIs(leads, handoffArray);
  }, [leads, handoffsMap]);

  // Priority Queue
  const priorityQueue = useMemo(() => {
    return filterAndSortPriorityQueue(leads, handoffsMap, filters);
  }, [leads, handoffsMap, filters]);

  // Active Filter Count
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

  // Helper formatting for currency
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
    <div className="min-h-screen bg-slate-50 text-slate-900 pb-16">
      {/* Top Header / Breadcrumb Context Bar */}
      <div className="bg-slate-900 border-b border-slate-800 text-white px-4 sm:px-6 lg:px-8 py-6">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <div className="flex items-center space-x-3 mb-1">
              <span className="px-2.5 py-0.5 rounded text-xs font-semibold uppercase tracking-wider bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                Phase 8B.1 Workspace
              </span>
              <span className="text-slate-400 text-xs font-mono">
                Tenant: Default Workspace
              </span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">
              Broker Command Center
            </h1>
            <p className="text-sm text-slate-400 mt-1 max-w-3xl">
              Prioritize qualified buyers, understand intent, and act on the opportunities most likely to convert.
            </p>
          </div>

          <div className="flex items-center space-x-3">
            <div className="hidden sm:flex flex-col text-right text-xs">
              <span className="text-slate-400 font-mono">Persistence Engine</span>
              <span className="text-emerald-400 font-medium">Preview Mode: Local Store</span>
            </div>
            <button
              onClick={loadDashboardData}
              disabled={isRefreshing}
              className="inline-flex items-center space-x-2 px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
            >
              <RotateCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin text-emerald-400' : ''}`} />
              <span>{isRefreshing ? 'Refreshing...' : 'Refresh'}</span>
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-8 space-y-8">
        {/* Error Alert */}
        {error && (
          <div className="bg-rose-50 border border-rose-200 rounded-xl p-4 flex items-start space-x-3 text-rose-800">
            <AlertTriangle className="w-5 h-5 text-rose-600 mt-0.5 shrink-0" />
            <div className="flex-1">
              <h3 className="text-sm font-semibold">Workspace Data Error</h3>
              <p className="text-xs text-rose-700 mt-0.5">{error}</p>
            </div>
            <button
              onClick={loadDashboardData}
              className="px-3 py-1 bg-rose-100 hover:bg-rose-200 text-rose-800 text-xs font-medium rounded-lg transition"
            >
              Retry
            </button>
          </div>
        )}

        {/* Top KPI Strip */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          {/* KPI 1: HOT */}
          <div className="bg-white border border-rose-200/80 rounded-xl p-5 shadow-sm hover:shadow transition relative overflow-hidden group">
            <div className="absolute top-0 right-0 w-24 h-24 bg-rose-500/5 rounded-full blur-xl group-hover:bg-rose-500/10 transition" />
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-rose-700 uppercase tracking-wider">HOT Buyers</span>
              <div className="p-2 bg-rose-100 rounded-lg text-rose-600">
                <Flame className="w-4 h-4" />
              </div>
            </div>
            <div className="mt-3 flex items-baseline space-x-2">
              <span className="text-3xl font-bold text-slate-900">{isLoading ? '–' : kpis.hotCount}</span>
              <span className="text-xs text-rose-600 font-medium">15m SLA</span>
            </div>
            <p className="text-xs text-slate-500 mt-1">High intent, immediate action</p>
          </div>

          {/* KPI 2: WARM */}
          <div className="bg-white border border-amber-200/80 rounded-xl p-5 shadow-sm hover:shadow transition relative overflow-hidden group">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-amber-700 uppercase tracking-wider">WARM Buyers</span>
              <div className="p-2 bg-amber-100 rounded-lg text-amber-600">
                <SunMedium className="w-4 h-4" />
              </div>
            </div>
            <div className="mt-3 flex items-baseline space-x-2">
              <span className="text-3xl font-bold text-slate-900">{isLoading ? '–' : kpis.warmCount}</span>
              <span className="text-xs text-amber-600 font-medium">2h SLA</span>
            </div>
            <p className="text-xs text-slate-500 mt-1">Active criteria, standard SLA</p>
          </div>

          {/* KPI 3: NEEDS ACTION */}
          <div className="bg-white border border-indigo-200/80 rounded-xl p-5 shadow-sm hover:shadow transition relative overflow-hidden group">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-indigo-700 uppercase tracking-wider">Needs Action</span>
              <div className="p-2 bg-indigo-100 rounded-lg text-indigo-600">
                <Clock className="w-4 h-4" />
              </div>
            </div>
            <div className="mt-3 flex items-baseline space-x-2">
              <span className="text-3xl font-bold text-slate-900">{isLoading ? '–' : kpis.needsActionCount}</span>
              <span className="text-xs text-indigo-600 font-medium">Follow-up due</span>
            </div>
            <p className="text-xs text-slate-500 mt-1">Pending broker response</p>
          </div>

          {/* KPI 4: PROJECT MATCHED */}
          <div className="bg-white border border-emerald-200/80 rounded-xl p-5 shadow-sm hover:shadow transition relative overflow-hidden group">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-emerald-700 uppercase tracking-wider">Project Matched</span>
              <div className="p-2 bg-emerald-100 rounded-lg text-emerald-600">
                <Building2 className="w-4 h-4" />
              </div>
            </div>
            <div className="mt-3 flex items-baseline space-x-2">
              <span className="text-3xl font-bold text-slate-900">{isLoading ? '–' : kpis.projectMatchedCount}</span>
              <span className="text-xs text-emerald-600 font-medium">Algorithmic</span>
            </div>
            <p className="text-xs text-slate-500 mt-1">Matched to catalog projects</p>
          </div>

          {/* KPI 5: HANDOFF PENDING */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm hover:shadow transition relative overflow-hidden group">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-600 uppercase tracking-wider">Handoff Pending</span>
              <div className="p-2 bg-slate-100 rounded-lg text-slate-600">
                <Layers className="w-4 h-4" />
              </div>
            </div>
            <div className="mt-3 flex items-baseline space-x-2">
              <span className="text-3xl font-bold text-slate-900">{isLoading ? '–' : kpis.handoffPendingCount}</span>
              <span className="text-xs text-slate-500 font-medium">Ready</span>
            </div>
            <p className="text-xs text-slate-500 mt-1">Awaiting CRM dispatch</p>
          </div>
        </div>

        {/* Filters & Search Control Panel */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-4">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            {/* Search Box */}
            <div className="relative flex-1 max-w-md">
              <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Search by buyer name, lead ID, phone, email..."
                value={filters.searchQuery || ''}
                onChange={(e) => setFilters((prev) => ({ ...prev, searchQuery: e.target.value }))}
                className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900 focus:bg-white transition"
              />
              {filters.searchQuery && (
                <button
                  onClick={() => setFilters((prev) => ({ ...prev, searchQuery: '' }))}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* Quick Filter Summaries / Clear */}
            <div className="flex items-center space-x-3 text-xs">
              <span className="text-slate-500 font-medium">
                {priorityQueue.length} {priorityQueue.length === 1 ? 'buyer' : 'buyers'} match filters
              </span>
              {activeFilterCount > 0 && (
                <button
                  onClick={resetFilters}
                  className="inline-flex items-center space-x-1 px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium rounded-md transition"
                >
                  <X className="w-3.5 h-3.5" />
                  <span>Clear Filters ({activeFilterCount})</span>
                </button>
              )}
            </div>
          </div>

          {/* Filter Selectors Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 pt-2 border-t border-slate-100">
            {/* Temperature Filter */}
            <div>
              <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1">
                Temperature
              </label>
              <select
                value={filters.temperature}
                onChange={(e) => setFilters((prev) => ({ ...prev, temperature: e.target.value as any }))}
                className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium text-slate-800 focus:outline-none focus:ring-1 focus:ring-slate-900"
              >
                <option value="ALL">All Temperatures</option>
                <option value="HOT">🔥 HOT</option>
                <option value="WARM">☀️ WARM</option>
                <option value="NURTURE">🌱 NURTURE</option>
              </select>
            </div>

            {/* Qualification Filter */}
            <div>
              <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1">
                Qualification
              </label>
              <select
                value={filters.qualification}
                onChange={(e) => setFilters((prev) => ({ ...prev, qualification: e.target.value }))}
                className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium text-slate-800 focus:outline-none focus:ring-1 focus:ring-slate-900"
              >
                <option value="ALL">All Qualifications</option>
                <option value="QUALIFIED">QUALIFIED</option>
                <option value="RAW">RAW</option>
                <option value="REQUIRES_REVIEW">REQUIRES_REVIEW</option>
                <option value="DISQUALIFIED">DISQUALIFIED</option>
              </select>
            </div>

            {/* Property Type Filter */}
            <div>
              <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1">
                Property Type
              </label>
              <select
                value={filters.propertyType}
                onChange={(e) => setFilters((prev) => ({ ...prev, propertyType: e.target.value }))}
                className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium text-slate-800 focus:outline-none focus:ring-1 focus:ring-slate-900"
              >
                <option value="ALL">All Property Types</option>
                <option value="Apartment">Apartment</option>
                <option value="Villa">Villa / House</option>
                <option value="Floor">Independent Floor</option>
                <option value="Plot">Plot / Land</option>
              </select>
            </div>

            {/* Budget Range Filter */}
            <div>
              <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1">
                Budget Range
              </label>
              <select
                value={filters.budgetRange}
                onChange={(e) => setFilters((prev) => ({ ...prev, budgetRange: e.target.value as any }))}
                className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium text-slate-800 focus:outline-none focus:ring-1 focus:ring-slate-900"
              >
                <option value="ALL">All Budgets</option>
                <option value="UNDER_1.5CR">&lt; ₹1.5 Cr</option>
                <option value="1.5CR_3CR">₹1.5 Cr – ₹3 Cr</option>
                <option value="ABOVE_3CR">&gt; ₹3 Cr</option>
              </select>
            </div>

            {/* Project Match Filter */}
            <div>
              <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1">
                Project Match
              </label>
              <select
                value={filters.projectMatch}
                onChange={(e) => setFilters((prev) => ({ ...prev, projectMatch: e.target.value as any }))}
                className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium text-slate-800 focus:outline-none focus:ring-1 focus:ring-slate-900"
              >
                <option value="ALL">All Match States</option>
                <option value="MATCHED">Matched Only</option>
                <option value="NO_MATCH">Unmatched Only</option>
              </select>
            </div>

            {/* Handoff Status Filter */}
            <div>
              <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1">
                Handoff Status
              </label>
              <select
                value={filters.handoffStatus}
                onChange={(e) => setFilters((prev) => ({ ...prev, handoffStatus: e.target.value as any }))}
                className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium text-slate-800 focus:outline-none focus:ring-1 focus:ring-slate-900"
              >
                <option value="ALL">All Handoff States</option>
                <option value="HANDED_OFF">Dispatched / Completed</option>
                <option value="PENDING">Pending Handoff</option>
                <option value="NOT_STARTED">Not Started</option>
              </select>
            </div>
          </div>
        </div>

        {/* Priority Buyers Table */}
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200 bg-slate-50/50 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h2 className="text-lg font-bold text-slate-900 flex items-center space-x-2">
                <span>Priority Buyers</span>
                <span className="text-xs px-2.5 py-0.5 rounded-full bg-slate-200 text-slate-700 font-semibold font-mono">
                  {priorityQueue.length}
                </span>
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Deterministic ranking: HOT tier first &rarr; Intent score &rarr; SLA deadline &rarr; Lead ID
              </p>
            </div>
          </div>

          {/* Table Content */}
          {isLoading ? (
            <div className="p-12 text-center text-slate-400 space-y-3">
              <RotateCw className="w-8 h-8 animate-spin mx-auto text-slate-400" />
              <p className="text-sm font-medium text-slate-600">Loading Broker Command Center workspace...</p>
            </div>
          ) : priorityQueue.length === 0 ? (
            <div className="p-12 text-center space-y-3">
              <User className="w-10 h-10 text-slate-300 mx-auto" />
              <h3 className="text-base font-semibold text-slate-800">No Buyers Found</h3>
              <p className="text-xs text-slate-500 max-w-sm mx-auto">
                No buyer records match your current filter criteria. Try resetting filters or searching with a different term.
              </p>
              {activeFilterCount > 0 && (
                <button
                  onClick={resetFilters}
                  className="inline-flex items-center space-x-2 px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-medium transition"
                >
                  <RotateCw className="w-3.5 h-3.5" />
                  <span>Reset All Filters</span>
                </button>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wider text-slate-500 border-b border-slate-200">
                    <th className="py-3 px-4">Lead ID</th>
                    <th className="py-3 px-4">Buyer</th>
                    <th className="py-3 px-4">Temp</th>
                    <th className="py-3 px-4">Score</th>
                    <th className="py-3 px-4">Property Type</th>
                    <th className="py-3 px-4">Budget Range</th>
                    <th className="py-3 px-4">Preferred Location</th>
                    <th className="py-3 px-4">Timeline</th>
                    <th className="py-3 px-4">Best Match</th>
                    <th className="py-3 px-4">Action & SLA</th>
                    <th className="py-3 px-4">Handoff</th>
                    <th className="py-3 px-4 text-right">Inspect</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-xs text-slate-800">
                  {priorityQueue.map((lead) => {
                    const qual = (lead.lead_intelligence?.qualification || '').toUpperCase();
                    const wf = (lead.workflow?.status || '').toUpperCase();
                    const isHot = qual === 'HOT' || wf === 'HOT';
                    const isWarm = qual === 'WARM' || wf === 'WARM';

                    const handoff = handoffsMap.get(lead.lead_id);
                    const slaInfo = getRecommendedActionAndSLA(lead, handoff);

                    const topMatch = lead.project_intelligence?.top_matches?.[0] || null;
                    const prefProj = lead.project_intelligence?.preferred_project?.project_name || null;
                    const bestMatchName = topMatch?.project_name || prefProj || 'Unmatched';
                    const matchScore = topMatch?.match_score ? `${topMatch.match_score}%` : null;

                    const budgetDisplay =
                      lead.buying_intent?.budget?.min || lead.buying_intent?.budget?.max
                        ? `${formatCurrency(lead.buying_intent.budget.min)} – ${formatCurrency(lead.buying_intent.budget.max)}`
                        : 'Undisclosed';

                    const locationDisplay =
                      lead.buying_intent?.preferred_locations?.join(', ') || lead.identity?.location || 'Unspecified';

                    return (
                      <tr
                        key={lead.lead_id}
                        className={`hover:bg-slate-50/80 transition cursor-pointer ${
                          isHot
                            ? 'bg-rose-50/30 border-l-4 border-l-rose-500'
                            : isWarm
                            ? 'border-l-4 border-l-amber-400'
                            : 'border-l-4 border-l-transparent'
                        }`}
                        onClick={() => setSelectedLead(lead)}
                      >
                        {/* Lead ID */}
                        <td className="py-3.5 px-4 font-mono font-bold text-slate-900 whitespace-nowrap">
                          {lead.lead_id}
                        </td>

                        {/* Buyer Identity */}
                        <td className="py-3.5 px-4">
                          <div className="font-semibold text-slate-900">{lead.identity?.full_name || 'Unnamed Buyer'}</div>
                          <div className="text-[11px] text-slate-500 flex items-center space-x-2 mt-0.5">
                            <span>{lead.identity?.phone || 'No phone'}</span>
                            {lead.identity?.company && (
                              <>
                                <span>&bull;</span>
                                <span>{lead.identity.company}</span>
                              </>
                            )}
                          </div>
                        </td>

                        {/* Temperature Badge */}
                        <td className="py-3.5 px-4 whitespace-nowrap">
                          {isHot ? (
                            <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-rose-100 text-rose-800 border border-rose-200">
                              <Flame className="w-3 h-3 text-rose-600" />
                              <span>HOT</span>
                            </span>
                          ) : isWarm ? (
                            <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-100 text-amber-800 border border-amber-200">
                              <SunMedium className="w-3 h-3 text-amber-600" />
                              <span>WARM</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-slate-100 text-slate-700 border border-slate-200">
                              <Leaf className="w-3 h-3 text-slate-500" />
                              <span>NURTURE</span>
                            </span>
                          )}
                        </td>

                        {/* Score */}
                        <td className="py-3.5 px-4 font-semibold whitespace-nowrap">
                          <span className="text-slate-900">{lead.lead_intelligence?.intent_score ?? 0}</span>
                          <span className="text-slate-400 font-normal">/100</span>
                        </td>

                        {/* Property Type */}
                        <td className="py-3.5 px-4 whitespace-nowrap font-medium text-slate-700">
                          {lead.buying_intent?.property_type || 'Apartment'}
                          {lead.buying_intent?.configuration && ` (${lead.buying_intent.configuration})`}
                        </td>

                        {/* Budget */}
                        <td className="py-3.5 px-4 whitespace-nowrap font-medium text-slate-800">
                          {budgetDisplay}
                        </td>

                        {/* Location */}
                        <td className="py-3.5 px-4 max-w-[160px] truncate text-slate-700" title={locationDisplay}>
                          {locationDisplay}
                        </td>

                        {/* Timeline */}
                        <td className="py-3.5 px-4 whitespace-nowrap text-slate-600">
                          {lead.buying_intent?.timeline || 'Immediate'}
                        </td>

                        {/* Best Match */}
                        <td className="py-3.5 px-4 whitespace-nowrap">
                          {bestMatchName !== 'Unmatched' ? (
                            <div className="flex items-center space-x-1.5">
                              <Building2 className="w-3.5 h-3.5 text-emerald-600" />
                              <span className="font-medium text-slate-900">{bestMatchName}</span>
                              {matchScore && (
                                <span className="text-[10px] font-semibold bg-emerald-100 text-emerald-800 px-1.5 py-0.2 rounded">
                                  {matchScore}
                                </span>
                              )}
                            </div>
                          ) : (
                            <span className="text-slate-400 italic">No match</span>
                          )}
                        </td>

                        {/* Action & SLA */}
                        <td className="py-3.5 px-4 whitespace-nowrap">
                          <div className="flex flex-col">
                            <span className="font-bold text-slate-900 text-[11px]">
                              {slaInfo.action}
                            </span>
                            <span className="text-[10px] font-semibold text-rose-600">
                              {slaInfo.slaLabel}
                            </span>
                          </div>
                        </td>

                        {/* Handoff Status */}
                        <td className="py-3.5 px-4 whitespace-nowrap">
                          {handoff?.handoff_status === 'COMPLETED' || handoff?.handoff_status === 'ACKNOWLEDGED' || wf === 'HANDED_OFF' ? (
                            <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-100 text-emerald-800">
                              <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                              <span>Handed Off</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-800">
                              <Clock className="w-3 h-3 text-amber-600" />
                              <span>Pending</span>
                            </span>
                          )}
                        </td>

                        {/* Action Button */}
                        <td className="py-3.5 px-4 text-right whitespace-nowrap">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedLead(lead);
                            }}
                            className="inline-flex items-center space-x-1 px-3 py-1 bg-slate-900 hover:bg-slate-800 text-white rounded text-xs font-medium transition"
                          >
                            <span>Inspect</span>
                            <ChevronRight className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* BUYER SNAPSHOT DRAWER (SLIDE-OVER PANEL) */}
      {selectedLead && (
        <div className="fixed inset-0 z-50 overflow-hidden flex justify-end">
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs transition-opacity"
            onClick={() => setSelectedLead(null)}
          />

          {/* Drawer Container */}
          <div className="relative w-full max-w-2xl bg-white shadow-2xl h-full flex flex-col z-10 overflow-hidden border-l border-slate-200">
            {/* Drawer Header */}
            <div className="px-6 py-5 bg-slate-900 text-white flex items-center justify-between border-b border-slate-800">
              <div>
                <div className="flex items-center space-x-2">
                  <span className="text-xs font-mono font-bold text-emerald-400">
                    {selectedLead.lead_id}
                  </span>
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-slate-800 text-slate-300">
                    {selectedLead.workflow?.status || 'RAW'}
                  </span>
                </div>
                <h2 className="text-xl font-bold text-white mt-1">
                  {selectedLead.identity?.full_name || 'Unnamed Buyer'}
                </h2>
              </div>

              <div className="flex items-center space-x-2">
                {onSelectLead && (
                  <button
                    onClick={() => {
                      onSelectLead(selectedLead);
                      setSelectedLead(null);
                    }}
                    className="inline-flex items-center space-x-1 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold transition"
                  >
                    <span>Full Dossier</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </button>
                )}
                <button
                  onClick={() => setSelectedLead(null)}
                  className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Drawer Scrollable Content */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {/* Section 1: Recommended Next Action Callout */}
              {(() => {
                const handoff = handoffsMap.get(selectedLead.lead_id);
                const slaInfo = getRecommendedActionAndSLA(selectedLead, handoff);
                return (
                  <div className="bg-slate-900 text-white rounded-xl p-5 shadow-sm relative overflow-hidden">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-semibold uppercase tracking-wider text-emerald-400">
                        Recommended Next Action
                      </span>
                      <span className="px-2.5 py-0.5 rounded text-xs font-bold bg-rose-500/20 text-rose-300 border border-rose-500/30">
                        {slaInfo.slaLabel}
                      </span>
                    </div>
                    <h3 className="text-lg font-bold text-white">{slaInfo.action}</h3>
                    <p className="text-xs text-slate-300 mt-1">{slaInfo.description}</p>

                    <div className="mt-4 pt-3 border-t border-slate-800 grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <span className="text-slate-400 block">Assigned Role:</span>
                        <span className="font-mono text-slate-200">{slaInfo.assignedRole}</span>
                      </div>
                      <div>
                        <span className="text-slate-400 block">Urgency Tier:</span>
                        <span className="font-semibold text-emerald-400">{slaInfo.urgency}</span>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Section 2: Identity & Contact */}
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-5 space-y-3">
                <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center space-x-1.5">
                  <User className="w-3.5 h-3.5 text-slate-700" />
                  <span>Buyer Identity</span>
                </h3>
                <div className="grid grid-cols-2 gap-4 text-xs">
                  <div>
                    <span className="text-slate-500 block">Full Name</span>
                    <span className="font-semibold text-slate-900">{selectedLead.identity?.full_name || 'N/A'}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Phone</span>
                    <span className="font-mono font-medium text-slate-900">{selectedLead.identity?.phone || 'N/A'}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Email</span>
                    <span className="font-mono text-slate-800">{selectedLead.identity?.email || 'N/A'}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Location</span>
                    <span className="text-slate-800">{selectedLead.identity?.location || 'N/A'}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Profession / Bio</span>
                    <span className="text-slate-800">{selectedLead.identity?.profession || 'N/A'}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Company</span>
                    <span className="text-slate-800">{selectedLead.identity?.company || 'N/A'}</span>
                  </div>
                </div>
              </div>

              {/* Section 3: Buying Intent Parameters */}
              <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
                <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center space-x-1.5">
                  <DollarSign className="w-3.5 h-3.5 text-slate-700" />
                  <span>Buying Intent & Parameters</span>
                </h3>
                <div className="grid grid-cols-2 gap-4 text-xs">
                  <div>
                    <span className="text-slate-500 block">Property Type</span>
                    <span className="font-semibold text-slate-900">{selectedLead.buying_intent?.property_type || 'Apartment'}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Configuration</span>
                    <span className="font-semibold text-slate-900">{selectedLead.buying_intent?.configuration || 'N/A'}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Purpose</span>
                    <span className="text-slate-800">{selectedLead.buying_intent?.purpose || 'Self Use'}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Budget Range</span>
                    <span className="font-semibold text-emerald-700">
                      {selectedLead.buying_intent?.budget?.min || selectedLead.buying_intent?.budget?.max
                        ? `${formatCurrency(selectedLead.buying_intent.budget.min)} – ${formatCurrency(selectedLead.buying_intent.budget.max)}`
                        : 'Undisclosed'}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Preferred Locations</span>
                    <span className="text-slate-800">{selectedLead.buying_intent?.preferred_locations?.join(', ') || 'N/A'}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Timeline</span>
                    <span className="text-slate-800">{selectedLead.buying_intent?.timeline || 'N/A'}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Financing Preference</span>
                    <span className="text-slate-800">{selectedLead.buying_intent?.financing || 'N/A'}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Decision Maker Status</span>
                    <span className="text-slate-800">
                      {selectedLead.buying_intent?.decision_maker ? 'Decision Maker Confirmed' : 'Unknown / Influencer'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Section 4: Truth Level & Provenance Assurance */}
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center space-x-1.5">
                    <ShieldCheck className="w-3.5 h-3.5 text-slate-700" />
                    <span>Data Provenance & Truth Levels</span>
                  </h3>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="p-2 bg-white rounded border border-slate-200 flex items-center justify-between">
                    <span className="text-slate-600">Buyer Name</span>
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800">CONFIRMED</span>
                  </div>
                  <div className="p-2 bg-white rounded border border-slate-200 flex items-center justify-between">
                    <span className="text-slate-600">Phone Number</span>
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800">CONFIRMED</span>
                  </div>
                  <div className="p-2 bg-white rounded border border-slate-200 flex items-center justify-between">
                    <span className="text-slate-600">Profession / Company</span>
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800">INFERRED</span>
                  </div>
                  <div className="p-2 bg-white rounded border border-slate-200 flex items-center justify-between">
                    <span className="text-slate-600">Budget Criteria</span>
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-indigo-100 text-indigo-800">KNOWN</span>
                  </div>
                </div>
                <p className="text-[11px] text-slate-500 flex items-center space-x-1.5 mt-2">
                  <Info className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  <span>
                    INFERRED data represents public profile enrichment or AI heuristics and is never presented as buyer-confirmed facts.
                  </span>
                </p>
              </div>

              {/* Section 5: Voice Call Evidence */}
              {(() => {
                const call = callsMap.get(selectedLead.lead_id);
                const transcript = transcriptsMap.get(selectedLead.lead_id);
                return (
                  <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center space-x-1.5">
                        <FileText className="w-3.5 h-3.5 text-slate-700" />
                        <span>Call & Conversation Evidence</span>
                      </h3>
                      {call && (
                        <span className="text-[11px] font-mono font-medium text-slate-600">
                          Duration: {call.duration_seconds || 120}s
                        </span>
                      )}
                    </div>

                    {call ? (
                      <div className="space-y-3">
                        <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 flex items-center justify-between text-xs">
                          <div>
                            <span className="text-slate-500">Call Status: </span>
                            <span className="font-semibold text-emerald-700">{call.status}</span>
                          </div>
                          <div>
                            <span className="text-slate-500">Provider: </span>
                            <span className="font-mono text-slate-700">{call.provider}</span>
                          </div>
                        </div>

                        {transcript && (
                          <div>
                            <button
                              onClick={() => setShowTranscriptDetails(!showTranscriptDetails)}
                              className="text-xs font-semibold text-slate-900 hover:underline flex items-center space-x-1"
                            >
                              <span>{showTranscriptDetails ? 'Hide Transcript' : 'View Conversation Transcript'}</span>
                              <ChevronRight className={`w-3.5 h-3.5 transition-transform ${showTranscriptDetails ? 'rotate-90' : ''}`} />
                            </button>

                            {showTranscriptDetails && (
                              <div className="mt-2 p-3 bg-slate-900 text-slate-200 rounded-lg text-xs font-mono space-y-2 max-h-48 overflow-y-auto">
                                {transcript.transcript_text ? (
                                  <pre className="whitespace-pre-wrap font-sans text-xs text-slate-300">
                                    {transcript.transcript_text}
                                  </pre>
                                ) : (
                                  <p className="text-slate-400 italic">No raw transcript text recorded.</p>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ) : (
                      <p className="text-xs text-slate-500 italic">No voice call record attached to this lead.</p>
                    )}
                  </div>
                );
              })()}

              {/* Section 6: Matched Projects & Recommendations */}
              <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
                <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center space-x-1.5">
                  <Building2 className="w-3.5 h-3.5 text-slate-700" />
                  <span>Algorithmic Project Matches</span>
                </h3>

                {selectedLead.project_intelligence?.top_matches?.length ? (
                  <div className="space-y-3">
                    {selectedLead.project_intelligence.top_matches.map((match) => (
                      <div key={match.id} className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
                        <div className="flex items-start justify-between">
                          <div>
                            <h4 className="font-bold text-slate-900 text-sm">{match.project_name}</h4>
                            <p className="text-xs text-slate-500">{match.developer_name} &bull; {match.locality}, {match.city}</p>
                          </div>
                          <div className="text-right">
                            <span className="text-base font-bold text-emerald-600">{match.match_score}% Fit</span>
                            <div className="mt-0.5">
                              {match.buyer_confirmed ? (
                                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800">
                                  Buyer Confirmed
                                </span>
                              ) : (
                                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-100 text-indigo-800">
                                  AI Recommended
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        {match.reason?.summary && (
                          <p className="text-xs text-slate-700 bg-white p-2.5 rounded border border-slate-200">
                            {match.reason.summary}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-slate-500 italic">No algorithmic project matches generated yet.</p>
                )}

                <p className="text-[11px] text-slate-400 flex items-center space-x-1.5">
                  <Info className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  <span>AI recommendations reflect algorithmic affinity scores and do not imply buyer confirmation.</span>
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
export default BrokerCommandCenterView;
