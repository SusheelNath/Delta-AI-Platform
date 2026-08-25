import React from 'react';
import useStore from '../../store/useStore';
import { FUNCTION_CATEGORIES } from '../../utils/colorScheme';
import './FunctionFilter.css';

export default function FunctionFilter() {
  const activeFunctionFilters = useStore((s) => s.activeFunctionFilters);
  const toggleFunctionFilter = useStore((s) => s.toggleFunctionFilter);
  const setAllFunctionFilters = useStore((s) => s.setAllFunctionFilters);

  const allActive = Object.values(activeFunctionFilters).every(Boolean);

  return (
    <div className="function-filter">
      <button
        className={`function-filter__pill function-filter__pill--all ${allActive ? 'function-filter__pill--active' : ''}`}
        onClick={() => setAllFunctionFilters(!allActive)}
      >
        All
      </button>
      {FUNCTION_CATEGORIES.map((cat, i) => (
        <button
          key={i}
          className={`function-filter__pill ${activeFunctionFilters[i] ? 'function-filter__pill--active' : ''}`}
          onClick={() => toggleFunctionFilter(i)}
        >
          <span
            className="function-filter__dot"
            style={{ background: activeFunctionFilters[i] ? cat.cssColor : '#4a5268' }}
          />
          {cat.label}
        </button>
      ))}
    </div>
  );
}
