import React, { useState } from 'react';
import { Flame, SunMedium, Leaf, ArrowRight, Building, Filter } from 'lucide-react';
import { GFBuyerLead, QualificationLevel } from '../types/buyerLead';

interface QualifiedBuyersViewProps {
  leads: GFBuyerLead[];
  onSelectLead: (leadId: string) => void;
}

export const QualifiedBuyersView: React.FC<QualifiedBuyersViewProps> = ({
  leads,
  onSelectLead,
}) => {
  const [filter, setFilter] = useState<'ALL' | 'HOT' | 'WARM' | 'NURTURE'>('ALL');

  // Filter leads that have gone through qualification or scoring
  const qualifiedLeads = leads.filter((l) => {
    const qual = l.lead_intelligence.qualification;
    if (filter === 'ALL') {
      return ['HOT', 'WARM', 'NURTURE'].includes(qual) || l.lead_intelligence.intent_score > 0;
    }
    return qual === filter;
  });

  const formatBudget = (min: number | null, max: number | null) => {
    if (!min && !max) return 'Undisclosed';
    const toCr = (num: number) => `₹${(num / 10000000).toFixed(1)} Cr`;
    if (min && max) return `${toCr(min)} – ${toCr(max)}`;
    if (min) return `From ${toCr(min)}`;
    if (max) return `Up to ${toCr(max)}`;
    return 'Undisclosed';
  };

  const getQualificationBadge = (qual: string | QualificationLevel) => {
    switch (qual) {
      case 'HOT':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-rose-50 text-rose-700 border border-rose-200">
            <Flame className="w-3 h-3 text-rose-600" />
            <span>HOT (90–100)</span>
          </span>
        );
      case 'WARM':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-amber-50 text-amber-700 border border-amber-200">
            <SunMedium className="w-3 h-3 text-amber-600" />
            <span>WARM (70–89)</span>
          </span>
        );
      case 'NURTURE':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-indigo-50 text-indigo-700 border border-indigo-200">
            <Leaf className="w-3 h-3 text-indigo-600" />
            <span>NURTURE (0–69)</span>
          </span>
        );
      default:
        return (
          <span className="px-2 py-0.5 rounded text-[10px] font-mono font-medium bg-slate-100 text-slate-700 border border-slate-200">
            {qual || 'PENDING'}
          </span>
        );
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      {/* Header & Filter Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200 mb-2">
            <span className="text-[10px] font-bold uppercase tracking-widest">Qualified Buyer Matrix</span>
          </div>
          <h2 className="text-2xl font-bold tracking-tight text-slate-900">
            Qualified Property Buyers
          </h2>
          <p className="text-sm text-slate-600">
            Structured real-estate buyer profiles qualified via autonomous voice discovery and scored against inventory.
          </p>
        </div>

        {/* Filter Pills */}
        <div className="flex items-center gap-1.5 p-1 bg-slate-100 rounded-lg border border-slate-200 text-xs">
          {(['ALL', 'HOT', 'WARM', 'NURTURE'] as const).map((lvl) => (
            <button
              key={lvl}
              type="button"
              onClick={() => setFilter(lvl)}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold uppercase tracking-wider transition-all cursor-pointer ${
                filter === lvl
                  ? 'bg-white text-indigo-700 shadow-2xs border border-slate-200'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {lvl === 'ALL' ? 'All Buyers' : lvl}
            </button>
          ))}
        </div>
      </div>

      {/* Main Table - Exact Columns from Master Specification Section 14 */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-700">
            <thead className="bg-slate-100/80 border-b border-slate-200 text-slate-700 font-semibold text-[11px] uppercase tracking-wider">
              <tr>
                <th className="py-3 px-4">Lead ID</th>
                <th className="py-3 px-4">Buyer</th>
                <th className="py-3 px-4">Location</th>
                <th className="py-3 px-4">Budget</th>
                <th className="py-3 px-4">Purpose</th>
                <th className="py-3 px-4">Timeline</th>
                <th className="py-3 px-4">Score</th>
                <th className="py-3 px-4">Qualification</th>
                <th className="py-3 px-4">Best Project</th>
                <th className="py-3 px-4 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {qualifiedLeads.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-8 text-center text-slate-500">
                    No buyers found for filter &quot;{filter}&quot;.
                  </td>
                </tr>
              ) : (
                qualifiedLeads.map((lead) => (
                  <tr
                    key={lead.lead_id}
                    onClick={() => onSelectLead(lead.lead_id)}
                    className="hover:bg-slate-50/80 cursor-pointer transition-colors"
                  >
                    {/* Lead ID */}
                    <td className="py-3 px-4 font-mono font-semibold text-slate-900">
                      {lead.lead_id}
                    </td>

                    {/* Buyer */}
                    <td className="py-3 px-4">
                      <div className="font-semibold text-slate-900">
                        {lead.identity.full_name}
                      </div>
                      <div className="text-[11px] text-slate-500 font-mono">
                        {lead.identity.profession || lead.identity.company || 'Private Buyer'}
                      </div>
                    </td>

                    {/* Location */}
                    <td className="py-3 px-4 text-slate-700">
                      {lead.buying_intent.preferred_locations.length > 0
                        ? lead.buying_intent.preferred_locations.slice(0, 2).join(', ')
                        : lead.identity.location || '—'}
                    </td>

                    {/* Budget */}
                    <td className="py-3 px-4 font-semibold text-slate-900 font-mono">
                      {formatBudget(lead.buying_intent.budget.min, lead.buying_intent.budget.max)}
                    </td>

                    {/* Purpose */}
                    <td className="py-3 px-4 text-slate-600">
                      {lead.buying_intent.purpose || '—'}
                    </td>

                    {/* Timeline */}
                    <td className="py-3 px-4 text-slate-600">
                      {lead.buying_intent.timeline || '—'}
                    </td>

                    {/* Score */}
                    <td className="py-3 px-4">
                      <div className="text-sm font-bold text-slate-900 font-mono">
                        {lead.lead_intelligence.intent_score}
                      </div>
                      <div className="text-[10px] text-slate-500 font-mono">
                        {Math.round(lead.lead_intelligence.confidence * 100)}% conf
                      </div>
                    </td>

                    {/* Qualification */}
                    <td className="py-3 px-4">
                      {getQualificationBadge(lead.lead_intelligence.qualification)}
                    </td>

                    {/* Best Project */}
                    <td className="py-3 px-4">
                      {lead.project_intelligence.preferred_project.project_name ? (
                        <div className="flex items-center gap-1.5 font-medium text-slate-900">
                          <Building className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                          <span className="truncate max-w-[140px]" title={lead.project_intelligence.preferred_project.project_name}>
                            {lead.project_intelligence.preferred_project.project_name}
                          </span>
                        </div>
                      ) : (
                        <span className="text-slate-400 italic">No match yet</span>
                      )}
                    </td>

                    {/* Action */}
                    <td className="py-3 px-4 text-right">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectLead(lead.lead_id);
                        }}
                        className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:text-indigo-800 cursor-pointer"
                      >
                        <span>DOSSIER</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
