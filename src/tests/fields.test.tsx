// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NumberField, TextField } from '../components/fields';

afterEach(cleanup);

describe('inspector fields', () => {
  it('TextField commits once on blur, not on every keystroke', () => {
    const onCommit = vi.fn();
    render(<TextField label="Name" value="Deck" onCommit={onCommit} />);
    const input = screen.getByLabelText('Name');
    fireEvent.change(input, { target: { value: 'Draw pile' } });
    fireEvent.change(input, { target: { value: 'Draw pile 2' } });
    expect(onCommit).not.toHaveBeenCalled();
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith('Draw pile 2');
  });

  it('NumberField clamps and rejects invalid numbers', () => {
    const onCommit = vi.fn();
    render(<NumberField label="Value" value={5} min={0} max={10} onCommit={onCommit} />);
    const input = screen.getByLabelText('Value') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '25' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onCommit).toHaveBeenLastCalledWith(10);
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(input.value).toBe('5');
  });

  it('NumberField allows clearing optional values', () => {
    const onCommit = vi.fn();
    render(<NumberField label="Maximum" value={3} allowEmpty onCommit={onCommit} />);
    const input = screen.getByLabelText('Maximum');
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledWith(null);
  });
});
