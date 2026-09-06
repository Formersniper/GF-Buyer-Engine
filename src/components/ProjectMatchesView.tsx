import React, { useState } from 'react';
import { Building, CheckCircle2, AlertCircle, Sparkles, MapPin, Tag, ArrowUpRight, Shield } from 'lucide-react';
import { Project, GFBuyerLead } from '../types/buyerLead';
import { SAMPLE_PROJECTS } from '../services/data/seedData';

interface ProjectMatchesViewProps {
  leads: GFBuyerLead[];
  onSelectLead: (leadId: string) => void;
}

export const ProjectMatchesView: React.FC<ProjectMatchesViewProps> = ({
  leads,
  onSelectLead,
}) => {
  const [selectedCity, setSelectedCity] = useState<string>('ALL');

  // Collect all active project matches across leads
  const allMatches = leads.flatMap((lead) =>
    lead.project_intelligence.top_matches.map((m) => ({
      ...m,
      buyerName: lead.identity.full_name,
      buyerLeadId: lead.lead_id,
      buyerBudget: lead.buying_intent.budget,
      buyerQualification: lead.lead_intelligence.qualification,
    }))
  );

  const formatPrice = (num: number) => `₹${(num / 10000000).toFixed(1)} Cr`;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Title & Architecture Principle */}
      <div className="space-y-1">
        <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
          <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
          <span className="text-[10px] font-bold uppercase tracking-widest">Controlled Project Catalog & Buyer Fit</span>
        </div>
        <h2 className="text-2xl font-bold tracking-tight text-slate-900">
          Project Matches & Inventory
        </h2>
        <p className="text-sm text-slate-600 max-w-3xl">
          Algorithmic matching across budget (25%), location (25%), configuration (15%), property type (10%), purpose (10%), timeline (5%), preferences (5%), and project attributes (5%).
        </p>
      </div>

      {/* Principle Callout */}
      <div className="p-4 rounded-lg bg-slate-100 border border-slate-200 flex items-start gap-3 text-xs text-slate-800">
        <Shield className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
        <p className="leading-relaxed">
          <strong className="text-slate-900">Frozen Architecture Principle:</strong> An AI project match is an algorithmically calculated fit — it does <em>not</em> automatically become a confirmed buyer preference until explicitly acknowledged or accepted by the buyer.
        </p>
      </div>

      {/* 1. Project Matches Matrix (Matches Table) */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-xs">
        <div className="p-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-900">
            Active Buyer-Project Matches ({allMatches.length})
          </h3>
          <span className="text-xs text-slate-500 font-mono">
            Click buyer row to inspect profile
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-700">
            <thead className="bg-slate-100/80 border-b border-slate-200 text-slate-700 font-semibold text-[11px] uppercase tracking-wider">
              <tr>
                <th className="py-3 px-4">Buyer Lead</th>
                <th className="py-3 px-4">Matched Project</th>
                <th className="py-3 px-4">Match Score</th>
                <th className="py-3 px-4">Match Reason & Dimension Highlights</th>
                <th className="py-3 px-4">Buyer Confirmed?</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {allMatches.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-slate-500">
                    No matches generated yet. Proceed with lead qualification in the Processing tab.
                  </td>
                </tr>
              ) : (
                allMatches.map((match) => (
                  <tr
                    key={match.id}
                    onClick={() => onSelectLead(match.buyerLeadId)}
                    className="hover:bg-slate-50/80 cursor-pointer transition-colors"
                  >
                    <td className="py-3 px-4">
                      <div className="font-semibold text-slate-900">
                        {match.buyerName}
                      </div>
                      <div className="font-mono text-[10px] text-slate-500">
                        {match.buyerLeadId}
                      </div>
                    </td>

                    <td className="py-3 px-4">
                      <div className="font-semibold text-slate-900 flex items-center gap-1.5">
                        <Building className="w-3.5 h-3.5 text-slate-500" />
                        <span>{match.project_name}</span>
                      </div>
                      <div className="text-[11px] text-slate-500">
                        {match.developer_name} • {match.locality}
                      </div>
                    </td>

                    <td className="py-3 px-4">
                      <div className="text-base font-bold text-slate-900 font-mono">
                        {match.match_score}%
                      </div>
                      <div className="text-[10px] text-slate-500 font-mono">
                        Budget {match.budget_score}% | Loc {match.location_score}%
                      </div>
                    </td>

                    <td className="py-3 px-4 max-w-sm">
                      <div className="text-slate-800 leading-snug mb-1">
                        {match.reason.summary}
                      </div>
                      {match.reason.highlights && match.reason.highlights.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {match.reason.highlights.map((h, i) => (
                            <span
                              key={i}
                              className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 text-[10px] font-medium"
                            >
                              ✓ {h}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>

                    <td className="py-3 px-4">
                      {match.buyer_confirmed ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-emerald-50 text-emerald-700 border border-emerald-200">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                          <span>Confirmed Preference</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-slate-100 text-slate-700 border border-slate-200">
                          <span>AI Algorithmic Fit</span>
                        </span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 2. Controlled Project Catalog */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-900">
            Controlled Project Catalog (V1 Demo Inventory)
          </h3>
          <span className="text-xs font-mono text-slate-500">
            {SAMPLE_PROJECTS.length} Seeded Projects
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {SAMPLE_PROJECTS.map((proj) => (
            <div
              key={proj.id}
              className="bg-white border border-slate-200 rounded-lg p-5 shadow-xs flex flex-col justify-between space-y-4 hover:border-slate-300 transition-colors"
            >
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-mono text-slate-500 font-semibold">
                    {proj.project_code}
                  </span>
                  <span className="px-2 py-0.5 rounded font-bold text-[9px] uppercase tracking-wider bg-emerald-50 text-emerald-700 border border-emerald-200">
                    {proj.status.toUpperCase()}
                  </span>
                </div>

                <div>
                  <h4 className="font-bold text-slate-900 text-base">
                    {proj.project_name}
                  </h4>
                  <p className="text-xs font-medium text-slate-600">
                    {proj.developer_name}
                  </p>
                </div>

                <div className="flex items-center gap-1 text-xs text-slate-500">
                  <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  <span>{proj.locality}, {proj.city}</span>
                </div>

                <p className="text-xs text-slate-600 leading-relaxed pt-1">
                  {proj.project_description}
                </p>

                <div className="pt-2 border-t border-slate-100 space-y-1.5 text-xs">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Price Range:</span>
                    <span className="font-bold text-slate-900 font-mono">
                      {formatPrice(proj.price_min)} – {formatPrice(proj.price_max)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Configurations:</span>
                    <span className="font-medium text-slate-800">
                      {proj.configurations.join(', ')}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Possession:</span>
                    <span className="font-medium text-slate-800">{proj.possession}</span>
                  </div>
                </div>

                <div className="flex flex-wrap gap-1 pt-1">
                  {proj.features.slice(0, 3).map((f, i) => (
                    <span
                      key={i}
                      className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 text-[10px]"
                    >
                      {f}
                    </span>
                  ))}
                </div>
              </div>

              <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
                <span className="text-[11px] text-slate-400 font-mono">
                  Catalog Verified
                </span>
                <a
                  href={proj.project_url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex items-center gap-1 font-semibold text-indigo-600 hover:text-indigo-800 cursor-pointer"
                >
                  <span>PROJECT BROCHURE</span>
                  <ArrowUpRight className="w-3.5 h-3.5" />
                </a>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
