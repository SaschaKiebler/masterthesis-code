-- Seed system analysis templates (is_system = true, tenant_id = NULL)

INSERT INTO analysis_templates (id, tenant_id, name, description, category, is_system, definition) VALUES

-- 1. Heizkurvenanalyse: Scatter AT vs. VL with regression + time series overlay
('00000000-0000-0000-0000-000000000101', NULL, 'Heizkurvenanalyse',
 'Scatter plot outdoor temperature vs. flow temperature with regression line, plus time series view.',
 'heating', true,
 '{
   "version": 1,
   "timeRange": {"preset": "30d"},
   "charts": [
     {
       "id": "hk-scatter",
       "title": "Heating Curve",
       "type": "scatter",
       "position": {"order": 0, "height": 400},
       "sources": [
         {"id": "src-at", "label": "Outdoor Temperature", "color": "#3b82f6", "yAxisIndex": 0,
          "binding": {"quantityName": "outdoor_temperature", "required": true}},
         {"id": "src-vl", "label": "Flow Temperature", "color": "#ef4444", "yAxisIndex": 0,
          "binding": {"quantityName": "flow_temperature", "required": true}}
       ],
       "calculations": [{"id": "calc-reg", "type": "regression", "label": "Regression", "color": "#ef4444", "inputs": {"x": "src-at", "y": "src-vl"}, "showAs": "line"}],
       "display": {"yAxes": [{"unit": "°C", "position": "left"}], "showLegend": true, "showDataZoom": false, "xSource": "src-at", "ySource": "src-vl"}
     },
     {
       "id": "hk-ts",
       "title": "Temperature Timeline",
       "type": "time_series",
       "position": {"order": 1, "height": 300},
       "sources": [
         {"id": "src-at2", "label": "Outdoor Temperature", "color": "#3b82f6", "yAxisIndex": 0,
          "binding": {"quantityName": "outdoor_temperature", "required": true}},
         {"id": "src-vl2", "label": "Flow Temperature", "color": "#ef4444", "yAxisIndex": 0,
          "binding": {"quantityName": "flow_temperature", "required": true}}
       ],
       "calculations": [],
       "display": {"yAxes": [{"unit": "°C", "position": "left"}], "showLegend": true, "showDataZoom": true}
     }
   ]
 }'::jsonb),

-- 2. Spreizungsanalyse: VL + RL + ΔT time series
('00000000-0000-0000-0000-000000000102', NULL, 'Spreizungsanalyse',
 'Flow + return temperature with calculated ΔT (temperature spread).',
 'heating', true,
 '{
   "version": 1,
   "timeRange": {"preset": "7d"},
   "charts": [
     {
       "id": "sp-ts",
       "title": "Temperature Spread",
       "type": "time_series",
       "position": {"order": 0, "height": 400},
       "sources": [
         {"id": "src-vl", "label": "Flow Temperature", "color": "#ef4444", "yAxisIndex": 0,
          "binding": {"quantityName": "flow_temperature", "required": true}},
         {"id": "src-rl", "label": "Return Temperature", "color": "#3b82f6", "yAxisIndex": 0,
          "binding": {"quantityName": "return_temperature", "required": true}}
       ],
       "calculations": [
         {"id": "calc-dt", "type": "difference", "label": "ΔT", "color": "#f59e0b", "inputs": {"a": "src-vl", "b": "src-rl"}, "showAs": "line", "yAxisIndex": 0}
       ],
       "display": {"yAxes": [{"unit": "°C", "position": "left"}], "showLegend": true, "showDataZoom": true}
     }
   ]
 }'::jsonb),

-- 3. Tagesprofil: Boxplot by hour of day
('00000000-0000-0000-0000-000000000103', NULL, 'Tagesprofil',
 'Boxplot showing value distribution by hour of day — reveals daily patterns and night setback.',
 'heating', true,
 '{
   "version": 1,
   "timeRange": {"preset": "30d"},
   "charts": [
     {
       "id": "tp-box",
       "title": "Daily Profile (by Hour)",
       "type": "boxplot",
       "position": {"order": 0, "height": 400},
       "sources": [
         {"id": "src-vl", "label": "Flow Temperature", "color": "#ef4444", "yAxisIndex": 0,
          "binding": {"quantityName": "flow_temperature", "required": true}}
       ],
       "calculations": [],
       "display": {"yAxes": [{"unit": "°C", "position": "left"}], "showLegend": true, "showDataZoom": false, "groupBy": "hour"}
     }
   ]
 }'::jsonb);
