import React, { useState, useEffect } from 'react';
import { Settings, Send, CheckCircle2, AlertTriangle, Loader2, Edit3, X, Save } from 'lucide-react';

export function CrmDispatchWorkspace({ leadId, handoffId, currentStatus, onDispatchSuccess }: { leadId: string, handoffId: string | undefined, currentStatus?: string, onDispatchSuccess?: () => void }) {
  const [configs, setConfigs] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDispatching, setIsDispatching] = useState(false);
  const [dispatchResult, setDispatchResult] = useState<any>(null);
  const [handoff, setHandoff] = useState<any>(null);

  const [editForm, setEditForm] = useState({
    id: '',
    provider_name: 'Salesforce',
    destination_type: 'API',
    endpoint_url: '',
    is_enabled: true,
    dry_run_mode: true
  });

  const loadData = async () => {
    setIsLoading(true);
    try {
      const cRes = await fetch('/api/crm/config');
      if (cRes.ok) {
        setConfigs(await cRes.json());
      }
      if (handoffId) {
        const hRes = await fetch(`/api/handoff/${handoffId}`);
        if (hRes.ok) {
          setHandoff(await hRes.json());
        }
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  const loadConfig = async () => {
    try {
      const res = await fetch('/api/crm-config');
      if (res.ok) {
        const data = await res.json();
        setConfigs(data);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [handoffId]);

  const handleEditClick = () => {
    const active = configs.find(c => c.is_enabled) || configs[0];
    if (active) {
      setEditForm({
        id: active.id,
        provider_name: active.provider_name,
        destination_type: active.destination_type,
        endpoint_url: active.endpoint_url || '',
        is_enabled: active.is_enabled,
        dry_run_mode: active.dry_run_mode
      });
    } else {
      setEditForm({
        id: '',
        provider_name: 'Salesforce',
        destination_type: 'API',
        endpoint_url: '',
        is_enabled: true,
        dry_run_mode: true
      });
    }
    setIsEditing(true);
  };

  const handleSaveConfig = async () => {
    setIsSaving(true);
    try {
      const url = editForm.id ? `/api/crm-config/${editForm.id}` : '/api/crm-config';
      const method = editForm.id ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editForm)
      });
      if (res.ok) {
        await loadConfig();
        setIsEditing(false);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDispatch = async (force: boolean = false) => {
    if (!handoffId) return;
    setIsDispatching(true);
    setDispatchResult(null);
    try {
      const res = await fetch(`/api/handoff/${handoffId}/dispatch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dryRun: false, forceRedispatch: force })
      });
      const data = await res.json();
      setDispatchResult(data);
      if (handoffId) {
        const hRes = await fetch(`/api/handoff/${handoffId}`);
        if (hRes.ok) setHandoff(await hRes.json());
      }
      if (data.success && onDispatchSuccess) {
        onDispatchSuccess();
      }
    } catch (err) {
      setDispatchResult({ success: false, error: String(err) });
    } finally {
      setIsDispatching(false);
    }
  };

  const activeConfig = configs.find(c => c.is_enabled);

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-5 shadow-xs space-y-4">
      <h3 className="text-sm font-semibold text-slate-900 border-b border-slate-100 pb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Send className="w-4 h-4 text-indigo-600" />
          <span>CRM Routing & Dispatch</span>
        </div>
      </h3>

      {isLoading ? (
        <div className="flex justify-center py-4">
          <Loader2 className="w-4 h-4 text-indigo-400 animate-spin" />
        </div>
      ) : isEditing ? (
        <div className="bg-slate-50 p-4 rounded border border-slate-200 text-xs space-y-4">
          <div className="flex justify-between items-center mb-2">
            <div className="font-semibold text-slate-900 flex items-center gap-1.5">
              <Settings className="w-4 h-4 text-indigo-600" /> Configure Destination
            </div>
            <button onClick={() => setIsEditing(false)} className="text-slate-400 hover:text-slate-600">
              <X className="w-4 h-4" />
            </button>
          </div>
          
          <div className="space-y-3">
            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Provider Name</label>
              <input type="text" value={editForm.provider_name} onChange={e => setEditForm({...editForm, provider_name: e.target.value})} className="w-full px-2 py-1.5 border border-slate-300 rounded focus:border-indigo-500 outline-none" placeholder="e.g. Salesforce, HubSpot" />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Destination Type</label>
              <select value={editForm.destination_type} onChange={e => setEditForm({...editForm, destination_type: e.target.value})} className="w-full px-2 py-1.5 border border-slate-300 rounded focus:border-indigo-500 outline-none">
                <option value="API">REST API</option>
                <option value="WEBHOOK">Webhook</option>
                <option value="MOCK_SALES_CHANNEL">Mock Sales Channel</option>
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Endpoint URL (Optional)</label>
              <input type="text" value={editForm.endpoint_url} onChange={e => setEditForm({...editForm, endpoint_url: e.target.value})} className="w-full px-2 py-1.5 border border-slate-300 rounded focus:border-indigo-500 outline-none" placeholder="https://..." />
            </div>
            
            <div className="flex items-center gap-4 pt-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={editForm.is_enabled} onChange={e => setEditForm({...editForm, is_enabled: e.target.checked})} className="accent-indigo-600" />
                <span className="font-medium text-slate-700">Enabled</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={editForm.dry_run_mode} onChange={e => setEditForm({...editForm, dry_run_mode: e.target.checked})} className="accent-indigo-600" />
                <span className="font-medium text-slate-700">Dry-Run Mode</span>
              </label>
            </div>
          </div>
          
          <div className="pt-3 border-t border-slate-200 flex justify-end gap-2">
            <button onClick={() => setIsEditing(false)} className="px-3 py-1.5 text-slate-600 font-medium hover:bg-slate-200 rounded">Cancel</button>
            <button onClick={handleSaveConfig} disabled={isSaving} className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded flex items-center gap-1.5">
              {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} Save Configuration
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="bg-slate-50 p-3 rounded border border-slate-200 text-xs">
            <div className="flex justify-between items-start mb-2">
              <div className="font-semibold text-slate-900 flex items-center gap-1.5">
                <Settings className="w-3.5 h-3.5 text-slate-500" /> Dispatch Destination
              </div>
              <button onClick={handleEditClick} className="text-indigo-600 hover:text-indigo-800 flex items-center gap-1 font-medium">
                <Edit3 className="w-3.5 h-3.5" /> Config
              </button>
            </div>
            
          {handoff && (
            <div className="bg-slate-50 p-3 rounded border border-slate-200 text-xs mt-4">
              <div className="font-semibold text-slate-900 flex items-center gap-1.5 mb-2 border-b border-slate-200 pb-2">
                <Settings className="w-3.5 h-3.5 text-slate-500" /> Dispatch Monitoring & Follow-up
              </div>
              <div className="grid grid-cols-2 gap-y-2 gap-x-4 text-slate-600 mt-2">
                <div>Dispatch Status: <span className="font-medium text-slate-900">{handoff.dispatch_status}</span></div>
                <div>Routing Status: <span className="font-medium text-slate-900">{handoff.routing_status}</span></div>
                <div>Handoff Status: <span className="font-medium text-slate-900">{handoff.handoff_status}</span></div>
                <div>Assigned Role: <span className="font-medium text-slate-900">{handoff.assigned_role || 'Unassigned'}</span></div>
                <div>Assigned Team: <span className="font-medium text-slate-900">{handoff.assigned_team || 'Unassigned'}</span></div>
                <div>SLA Deadline: <span className="font-medium text-slate-900">{handoff.sla_deadline ? new Date(handoff.sla_deadline).toLocaleString() : 'N/A'}</span></div>
                {handoff.dispatch_id && <div className="col-span-2">Dispatch ID: <span className="font-mono text-[10px] text-slate-800 bg-slate-100 px-1 py-0.5 rounded">{handoff.dispatch_id}</span></div>}
                {handoff.dispatch_error && <div className="col-span-2 text-red-600">Error: <span className="font-medium">{handoff.dispatch_error}</span></div>}
                {(handoff.retry_count !== undefined && handoff.retry_count > 0) && <div>Retry Count: <span className="font-medium text-slate-900">{handoff.retry_count}</span></div>}
                {handoff.last_attempt_at && <div className="col-span-2">Last Attempt: <span className="font-medium text-slate-900">{new Date(handoff.last_attempt_at).toLocaleString()}</span></div>}
              </div>
            </div>
          )}

            {activeConfig ? (
              <div className="grid grid-cols-2 gap-y-2 gap-x-4 text-slate-600 mt-2">
                <div>Provider: <span className="font-medium text-slate-900">{activeConfig.provider_name}</span></div>
                <div>Type: <span className="font-medium text-slate-900">{activeConfig.destination_type}</span></div>
                <div>Status: <span className="font-medium text-emerald-600">Enabled</span></div>
                <div>Mode: <span className={`font-medium ${activeConfig.dry_run_mode ? 'text-amber-600' : 'text-indigo-600'}`}>{activeConfig.dry_run_mode ? 'Dry-Run (Safe)' : 'Production / Live'}</span></div>
              </div>
            ) : (
               <div className="text-amber-700 flex items-center gap-2">
                 <AlertTriangle className="w-4 h-4" /> No active CRM configuration. Defaults to Mock Channel.
               </div>
            )}
          </div>

          <div className="pt-2">
             <button
                onClick={() => handleDispatch(false)}
                disabled={isDispatching || !handoffId || handoff?.dispatch_status === 'SENT' || handoff?.dispatch_status === 'ACKNOWLEDGED'}

                className="w-full py-2.5 bg-slate-900 hover:bg-slate-800 disabled:bg-slate-300 text-white rounded-lg text-xs font-bold transition-colors flex items-center justify-center gap-2"
             >
                {isDispatching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                {handoff?.dispatch_status === 'SENT' || handoff?.dispatch_status === 'ACKNOWLEDGED' ? 'ALREADY DISPATCHED' : 'DISPATCH HANDOFF TO CRM'}
             </button>
          </div>
          
          {handoff?.dispatch_status === 'FAILED' && handoff?.retry_eligible && (
            <div className="pt-2">
              <button
                onClick={() => handleDispatch(true)}
                disabled={isDispatching}
                className="w-full py-2.5 bg-amber-600 hover:bg-amber-700 disabled:bg-amber-300 text-white rounded-lg text-xs font-bold transition-colors flex items-center justify-center gap-2"
              >
                {isDispatching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                RETRY DISPATCH (FORCE)
              </button>
            </div>
          )}

          {dispatchResult && (
            <div className={`p-3 rounded text-xs border ${dispatchResult.success ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-red-50 border-red-200 text-red-800'}`}>
              <div className="font-semibold mb-1 flex items-center gap-1.5">
                {dispatchResult.success ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertTriangle className="w-3.5 h-3.5" />}
                {dispatchResult.success ? 'Dispatch Successful' : 'Dispatch Failed'}
              </div>
              {dispatchResult.error && <div>{dispatchResult.error}</div>}
              {dispatchResult.dispatch_id && <div>Dispatch ID: <span className="font-mono">{dispatchResult.dispatch_id}</span></div>}
              {dispatchResult.channel && <div>Route: {dispatchResult.channel}</div>}
              {dispatchResult.message && <div className="mt-2 text-slate-600 border-t border-emerald-100 pt-1">{dispatchResult.message}</div>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
