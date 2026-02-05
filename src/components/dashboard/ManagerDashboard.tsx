import React from 'react';
import { Users, TrendingUp, AlertTriangle, Activity } from 'lucide-react';

export function ManagerDashboard() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
          <div className="flex items-center space-x-3">
            <div className="p-3 bg-blue-100 rounded-lg text-blue-600">
              <TrendingUp className="w-6 h-6" />
            </div>
            <div>
              <p className="text-sm text-slate-500 font-medium">Total Volume</p>
              <p className="text-2xl font-bold text-slate-900">$12.4M</p>
            </div>
          </div>
        </div>

        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
          <div className="flex items-center space-x-3">
            <div className="p-3 bg-purple-100 rounded-lg text-purple-600">
              <Users className="w-6 h-6" />
            </div>
            <div>
              <p className="text-sm text-slate-500 font-medium">Active Loans</p>
              <p className="text-2xl font-bold text-slate-900">45</p>
            </div>
          </div>
        </div>

        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
          <div className="flex items-center space-x-3">
            <div className="p-3 bg-amber-100 rounded-lg text-amber-600">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <div>
              <p className="text-sm text-slate-500 font-medium">SLA Breaches</p>
              <p className="text-2xl font-bold text-slate-900">3</p>
            </div>
          </div>
        </div>

        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
          <div className="flex items-center space-x-3">
            <div className="p-3 bg-green-100 rounded-lg text-green-600">
              <Activity className="w-6 h-6" />
            </div>
            <div>
              <p className="text-sm text-slate-500 font-medium">Avg Turn Time</p>
              <p className="text-2xl font-bold text-slate-900">14d</p>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
          <h3 className="text-lg font-semibold text-slate-900 mb-4">Pipeline by Stage</h3>
          <div className="space-y-4">
            {[
              { stage: 'Intake', count: 8, color: 'bg-slate-500' },
              { stage: 'Disclosures', count: 12, color: 'bg-blue-500' },
              { stage: 'Processing', count: 15, color: 'bg-purple-500' },
              { stage: 'Underwriting', count: 7, color: 'bg-amber-500' },
              { stage: 'Closing', count: 3, color: 'bg-green-500' },
            ].map((item) => (
              <div key={item.stage}>
                <div className="flex justify-between text-sm mb-1">
                  <span className="font-medium text-slate-700">{item.stage}</span>
                  <span className="text-slate-500">{item.count} loans</span>
                </div>
                <div className="w-full bg-slate-100 rounded-full h-2">
                  <div className={`${item.color} h-2 rounded-full`} style={{ width: `${(item.count / 45) * 100}%` }}></div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
          <h3 className="text-lg font-semibold text-slate-900 mb-4">Team Performance</h3>
          <div className="space-y-4">
            {[
              { name: 'Sarah Miller', role: 'Loan Officer', loans: 12, status: 'Top Performer' },
              { name: 'Mike Ross', role: 'Processor', loans: 8, status: 'On Track' },
              { name: 'Jessica Pearson', role: 'Manager', loans: 45, status: 'Active' },
            ].map((person) => (
              <div key={person.name} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                <div className="flex items-center space-x-3">
                  <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-bold text-xs">
                    {person.name.charAt(0)}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-slate-900">{person.name}</p>
                    <p className="text-xs text-slate-500">{person.role}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-sm font-bold text-slate-900">{person.loans}</p>
                  <p className="text-xs text-slate-500">Active Files</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
