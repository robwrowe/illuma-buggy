import { useMemo, useState } from 'react';
import { Alert, Button, Group, Modal, Radio, Stack, Text, Textarea, TextInput } from '@mantine/core';
import { bytesToHex } from '../../lib/ble/e9Decode';
import { flattenRowTags, generateRuleFromTags } from '../../lib/ble/byteAnalyzer';
import { SearchableSelect } from '../shared/SearchableSelect';
import { generateId } from '../../lib/utils';

/**
 * @param {object} row  { id, bytes }
 * @param {object} columnTags
 * @param {object} cellTags  cellTags FOR THIS ROW ONLY
 * @param {object[]} rules  mb.rules — existing rules, for the "link" picker
 */
export function AnalyzerFindingForm({
  row,
  columnTags,
  cellTags,
  rules,
  onCancel,
  onSubmit,
  onGenerateRule,
}) {
  const [opcode, setOpcode] = useState('');
  const [notes, setNotes] = useState('');
  const [mode, setMode] = useState('none');
  const [linkedRuleId, setLinkedRuleId] = useState('');
  const [ruleName, setRuleName] = useState('');

  const byteTags = useMemo(
    () => flattenRowTags(row.bytes, columnTags, cellTags),
    [row, columnTags, cellTags],
  );
  const preview = useMemo(
    () => (mode === 'generate' ? generateRuleFromTags(row.bytes, byteTags, { ruleName }) : null),
    [mode, row, byteTags, ruleName],
  );

  const ruleOptions = (rules || []).map((r) => ({
    value: r.id,
    label: r.name || r.id,
    searchText: r.name || r.id,
  }));

  const submit = () => {
    const base = {
      id: generateId(),
      createdAt: Date.now(),
      hex: bytesToHex(row.bytes),
      opcode: opcode.trim(),
      notes: notes.trim(),
      byteTags,
      linkedRuleId: mode === 'link' ? linkedRuleId : '',
      generatedRuleId: '',
    };
    if (mode === 'generate' && preview) {
      onGenerateRule(preview.rule);
      onSubmit({ ...base, generatedRuleId: preview.rule.id });
      return;
    }
    onSubmit(base);
  };

  return (
    <Modal opened onClose={onCancel} title="Log byte-tag finding" size="md">
      <Stack gap="sm">
        <TextInput
          label="Opcode (optional override)"
          value={opcode}
          onChange={(e) => setOpcode(e.target.value)}
        />
        <Textarea
          label="Notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          minRows={2}
        />

        <Radio.Group label="Rule association" value={mode} onChange={setMode}>
          <Group gap="md" mt={4}>
            <Radio value="none" label="None" />
            <Radio value="link" label="Link to existing rule" />
            <Radio value="generate" label="Generate new rule" />
          </Group>
        </Radio.Group>

        {mode === 'link' && (
          <SearchableSelect
            label="Existing rule"
            value={linkedRuleId}
            onChange={setLinkedRuleId}
            options={ruleOptions}
            placeholder="Search rules…"
          />
        )}

        {mode === 'generate' && (
          <Stack gap={6}>
            <TextInput
              label="New rule name"
              value={ruleName}
              onChange={(e) => setRuleName(e.target.value)}
              placeholder="Generated from analyzer"
            />
            {preview?.warnings.map((w, i) => (
              <Alert key={i} color="yellow" py={4}>
                {w}
              </Alert>
            ))}
            <Text size="xs" c="dimmed">
              Creates a draft rule in Settings → Rules (not pushed to the board). Finish targeting
              and enable it there.
            </Text>
          </Stack>
        )}

        <Group justify="flex-end">
          <Button variant="default" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={mode === 'link' && !linkedRuleId}>
            {mode === 'generate' ? 'Generate rule + log finding' : 'Log finding'}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
