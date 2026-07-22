(() => {
  'use strict';

  const data = window.DBMS_REQUIREMENTS_MAP;
  if (!data) {
    document.getElementById('map-canvas').textContent = 'The generated map data could not be loaded.';
    return;
  }

  const guide = data.readerGuide;

  const ownerColors = {
    base: '#315e8a',
    crypto: '#28735d',
    cloud: '#2a7186',
    dbaas: '#a25824',
  };
  const categoryColors = {
    mandatory: '#243f56',
    selection: '#8d5b16',
    catalogue: '#256c56',
    optional: '#6c5683',
    assurance: '#9a3f4f',
  };
  const categoryLabels = {
    mandatory: 'Mandatory',
    selection: 'Selection-based',
    catalogue: 'Catalogue-derived',
    optional: 'Optional',
    assurance: 'Assurance',
  };
  const relationshipLabels = {
    selection: 'Selection condition',
    cascade: 'Dependency cascade',
    package: 'Package applicability',
  };
  const assuranceClasses = new Set(['ADV', 'AGD', 'ALC', 'ASE', 'ATE', 'AVA']);
  const artifactById = new Map(data.artifacts.map((artifact) => [artifact.id, artifact]));
  const externalSourceById = new Map(data.externalSources.map((source) => [source.id, source]));
  const requirementByUid = new Map(data.requirements.map((requirement) => [requirement.uid, requirement]));
  const selectionTriggers = data.selectionTriggers || [];
  const triggersBySource = new Map();
  const triggersByTarget = new Map();
  for (const trigger of selectionTriggers) {
    if (!triggersBySource.has(trigger.sourceUid)) triggersBySource.set(trigger.sourceUid, []);
    triggersBySource.get(trigger.sourceUid).push(trigger);
    if (trigger.targetUid) {
      if (!triggersByTarget.has(trigger.targetUid)) triggersByTarget.set(trigger.targetUid, []);
      triggersByTarget.get(trigger.targetUid).push(trigger);
    }
  }
  const triggerEndpointUids = new Set(selectionTriggers.flatMap((trigger) => [trigger.sourceUid, trigger.targetUid]).filter(Boolean));

  const state = {
    configuration: 'all',
    query: '',
    categories: new Set(Object.keys(categoryLabels)),
    view: location.hash.startsWith('#req-') ? 'outline' : 'triggers',
    page: location.hash.startsWith('#req-') ? 'explorer' : 'guide',
    architectureDomain: guide?.architectureDomains?.[0]?.id || null,
    zoom: 1,
  };

  const elements = {
    pageModeControl: document.getElementById('page-mode-control'),
    configurationControl: document.getElementById('configuration-control'),
    compositionMap: document.getElementById('composition-map'),
    guide: document.getElementById('reader-guide'),
    explorer: document.getElementById('explorer-shell'),
    viewControl: document.getElementById('view-mode-control'),
    typeFilters: document.getElementById('type-filters'),
    search: document.getElementById('search-input'),
    map: document.getElementById('map-canvas'),
    summary: document.getElementById('result-summary'),
    legend: document.getElementById('legend'),
    empty: document.getElementById('empty-state'),
    workspace: document.getElementById('workspace'),
    reader: document.getElementById('reader-panel'),
    readerResizer: document.getElementById('reader-resizer'),
    readerTitle: document.getElementById('reader-title'),
    readerFrame: document.getElementById('document-frame'),
    readerNewWindow: document.getElementById('reader-new-window'),
    zoomValue: document.getElementById('zoom-value'),
    expandAll: document.getElementById('expand-all'),
    collapseAll: document.getElementById('collapse-all'),
  };

  function escapeHtml(value = '') {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function escapeAttribute(value = '') {
    return escapeHtml(value).replace(/`/g, '&#096;');
  }

  function sourceButton(source, label, title) {
    if (!source?.url) return '';
    const url = `${source.url}${source.anchor ? `#${source.anchor}` : ''}`;
    return `<button class="source-link js-read-source" type="button" data-url="${escapeAttribute(url)}" data-title="${escapeAttribute(title)}">${escapeHtml(label)}</button>`;
  }

  function requirementDomId(uid) {
    return `req-${uid.replace(/[^A-Za-z0-9_-]+/g, '-')}`;
  }

  function activeConfiguration() {
    return data.configurations.find(({ id }) => id === state.configuration) || null;
  }

  function activeModules() {
    return activeConfiguration()?.modules || data.artifacts.map(({ id }) => id);
  }

  function renderPageModeControl() {
    elements.pageModeControl.querySelectorAll('[data-page-mode]').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.pageMode === state.page));
    });
    elements.guide.hidden = state.page !== 'guide';
    elements.explorer.hidden = state.page !== 'explorer';
  }

  function renderConfigurationControl() {
    const choices = [{ id: 'all', label: 'Compare all drafts' }, ...data.configurations];
    elements.configurationControl.innerHTML = choices.map((choice) => `
      <button type="button" data-configuration="${escapeAttribute(choice.id)}" aria-pressed="${choice.id === state.configuration}">${escapeHtml(choice.label)}</button>
    `).join('');
  }

  function renderViewControl() {
    const choices = [
      { id: 'triggers', label: 'Trigger map' },
      { id: 'hierarchy', label: 'Hierarchy' },
      { id: 'outline', label: 'Outline' },
    ];
    elements.viewControl.innerHTML = choices.map((choice) => `
      <button type="button" data-view="${choice.id}" aria-pressed="${choice.id === state.view}">${escapeHtml(choice.label)}</button>
    `).join('');
    const hasCollapsibleNodes = state.view !== 'triggers';
    elements.expandAll.disabled = !hasCollapsibleNodes;
    elements.collapseAll.disabled = !hasCollapsibleNodes;
  }

  function renderComposition() {
    const configuration = activeConfiguration();
    const modules = activeModules();
    const node = (owner) => {
      const artifact = artifactById.get(owner);
      return `
        <div class="composition-node" style="--owner-color:${ownerColors[owner]}">
          <strong>${escapeHtml(artifact.shortLabel)}</strong>
          <span>${escapeHtml(artifact.label)}</span>
        </div>
      `;
    };
    const flow = configuration
      ? `<div class="composition-flow">${modules.map(node).join('')}</div>`
      : `<div class="composition-flow">
          ${node('base')}${node('crypto')}
          <div class="composition-branch">
            <span class="composition-branch-label">Choose one deployment overlay</span>
            <div class="composition-branch-options">${node('cloud')}${node('dbaas')}</div>
          </div>
        </div>`;
    const dependencies = modules.includes('crypto')
      ? `<div class="composition-dependencies">
          <span class="composition-dependencies-label">Consumed or triggered sources</span>
          ${data.externalSources.map((source) => `
            <div class="composition-node external-node" style="--owner-color:${ownerColors.crypto}" title="${escapeAttribute(source.note)}">
              <strong>${escapeHtml(source.shortLabel)}</strong>
              <span>${escapeHtml(source.type)}</span>
            </div>
          `).join('')}
        </div>`
      : '';
    const context = configuration
      ? `<div class="configuration-context">
          <strong>${escapeHtml(configuration.operator)} operated</strong>
          <span>${escapeHtml(configuration.deployment)} Boundary question: ${escapeHtml(configuration.boundaryQuestion)}</span>
          <a class="source-link" href="${escapeAttribute(configuration.url)}" target="_blank" rel="noopener" title="${escapeAttribute(configuration.note)}">Open PP-Configuration</a>
        </div>`
      : `<div class="configuration-context">
          <strong>Comparison scope</strong>
          <span>This is a review-set comparison, not a conformant PP-Configuration. Cloud and DBaaS are alternative deployment overlays; select a configuration to review one architecture end to end.</span>
        </div>`;
    elements.compositionMap.innerHTML = `${flow}${dependencies}${context}`;
  }

  function renderTypeFilters() {
    elements.typeFilters.innerHTML = '<legend>Requirement type</legend>' + Object.entries(categoryLabels).map(([category, label]) => `
      <label class="type-filter" style="--filter-color:${categoryColors[category]}">
        <input type="checkbox" value="${category}" ${state.categories.has(category) ? 'checked' : ''}>
        <span>${escapeHtml(label)}</span>
      </label>
    `).join('');
  }

  function renderLegend() {
    elements.legend.innerHTML = data.artifacts.map((artifact) => `
      <span class="legend-item"><span class="legend-swatch" style="--swatch:${ownerColors[artifact.id]}"></span>${escapeHtml(artifact.shortLabel)}</span>
    `).join('') + '<span class="legend-item"><span class="legend-trigger" aria-hidden="true">-&gt;</span>Selection or dependency includes requirement</span>';
  }

  function renderModuleDigest(artifact) {
    return `
      <article class="module-digest" data-owner="${escapeAttribute(artifact.id)}">
        <div class="module-digest-title">
          <strong>${escapeHtml(artifact.shortLabel)}</strong>
          <span>${escapeHtml(artifact.label)}</span>
        </div>
        <div class="module-digest-body">
          <p>${escapeHtml(artifact.digest)}</p>
          <div class="module-links">
            <a href="${escapeAttribute(artifact.ppUrl)}" target="_blank" rel="noopener">Read PP${artifact.kind === 'module' ? '-Module' : ''}</a>
            <a href="${escapeAttribute(artifact.sdUrl)}" target="_blank" rel="noopener">Read Supporting Document</a>
          </div>
        </div>
        <div class="module-digest-scope">
          <p><strong>Owns</strong>${escapeHtml(artifact.owns)}</p>
          <p><strong>Defers</strong>${escapeHtml(artifact.defers)}</p>
          <p><strong>Reviewer prompt</strong>${escapeHtml(artifact.reviewPrompt)}</p>
        </div>
      </article>
    `;
  }

  function renderArchitectureNav(domains) {
    let currentGroup = null;
    let index = 0;
    return domains.map((domain) => {
      const group = domain.group !== currentGroup
        ? `<span class="architecture-nav-group">${escapeHtml(domain.group)}</span>`
        : '';
      currentGroup = domain.group;
      index += 1;
      return `${group}
        <button type="button" data-architecture-domain="${escapeAttribute(domain.id)}" aria-pressed="${domain.id === state.architectureDomain}">
          <span class="architecture-nav-index">${String(index).padStart(2, '0')}</span>
          <span>${escapeHtml(domain.title)}</span>
        </button>`;
    }).join('');
  }

  function renderDomainModule(owner, requirements) {
    const artifact = artifactById.get(owner);
    return `
      <div class="domain-module" data-owner="${escapeAttribute(owner)}">
        <span class="domain-module-name">${escapeHtml(artifact?.shortLabel || owner)}</span>
        <div class="domain-requirements">
          ${requirements.map((requirement) => `
            <button class="requirement-chip js-jump-requirement" type="button" data-requirement-uid="${escapeAttribute(requirement.uid)}" title="Open ${escapeAttribute(requirement.id)} in the Requirements Explorer">
              <strong>${escapeHtml(requirement.id)}</strong>
              <span>${escapeHtml(categoryLabels[requirement.category])} &middot; ${requirement.activityCount} EA / ${requirement.testCount} test${requirement.testCount === 1 ? '' : 's'}</span>
            </button>
          `).join('')}
        </div>
      </div>
    `;
  }

  function renderArchitectureDomain(domain) {
    const modules = new Set(activeModules());
    const requirements = domain.requirements.filter(({ owner }) => modules.has(owner));
    const byOwner = new Map();
    for (const requirement of requirements) {
      if (!byOwner.has(requirement.owner)) byOwner.set(requirement.owner, []);
      byOwner.get(requirement.owner).push(requirement);
    }
    const activityCount = requirements.reduce((sum, requirement) => sum + requirement.activityCount, 0);
    const testCount = requirements.reduce((sum, requirement) => sum + requirement.testCount, 0);
    const ownerOrder = activeModules();
    return `
      <article class="architecture-domain" aria-labelledby="architecture-domain-title">
        <header class="architecture-domain-header">
          <p class="eyebrow">${escapeHtml(domain.group)}</p>
          <h3 id="architecture-domain-title">${escapeHtml(domain.title)}</h3>
          <p class="architecture-question">${escapeHtml(domain.question)}</p>
          <p class="architecture-summary">${escapeHtml(domain.summary)}</p>
          <div class="arc-tags" aria-label="ADV_ARC coverage">
            ${domain.arcElements.map((element) => `<span class="arc-tag">${escapeHtml(element)}</span>`).join('')}
          </div>
        </header>
        <div class="architecture-domain-body">
          <section>
            <h4>Requirement trail for this scope</h4>
            <div class="domain-module-list">
              ${ownerOrder.filter((owner) => byOwner.has(owner)).map((owner) => renderDomainModule(owner, byOwner.get(owner))).join('')}
            </div>
            <p class="domain-evidence-summary">${requirements.length} mapped requirements lead to ${activityCount} evaluation activities, including ${testCount} tests. Select any requirement to open its normative text and evidence trail.</p>
          </section>
          <section>
            <h4>Review checks</h4>
            <ul class="review-checks">${domain.reviewChecks.map((check) => `<li>${escapeHtml(check)}</li>`).join('')}</ul>
          </section>
        </div>
      </article>
    `;
  }

  function renderReaderGuide() {
    if (!guide) {
      elements.guide.innerHTML = '<div class="empty-state"><h2>Reader\'s guide unavailable</h2><p>Regenerate the requirements-map data to include the review supplement.</p></div>';
      return;
    }
    const modules = new Set(activeModules());
    const visibleArtifacts = data.artifacts.filter(({ id }) => modules.has(id));
    const domain = guide.architectureDomains.find(({ id }) => id === state.architectureDomain) || guide.architectureDomains[0];
    state.architectureDomain = domain.id;
    const configuration = activeConfiguration();
    const scopeLabel = configuration?.label || 'all draft artifacts for comparison';
    elements.guide.innerHTML = `
      <section class="guide-hero" aria-labelledby="guide-title">
        <div>
          <p class="eyebrow">Non-normative orientation</p>
          <h2 id="guide-title">${escapeHtml(guide.title)}</h2>
          <p class="guide-lede">${escapeHtml(guide.summary)} The current scope is <strong>${escapeHtml(scopeLabel)}</strong>.</p>
          <p class="guide-disclaimer">${escapeHtml(guide.disclaimer)}</p>
        </div>
        <aside class="guide-reading-order" aria-label="Suggested reading order">
          <h3>Four-pass review</h3>
          <ol>${guide.readingOrder.map((step) => `<li>${escapeHtml(step)}</li>`).join('')}</ol>
        </aside>
      </section>

      <section class="guide-section" aria-labelledby="module-stack-title">
        <div class="guide-section-heading">
          <div><p class="eyebrow">Responsibility model</p><h2 id="module-stack-title">What each artifact adds</h2></div>
          <p>The Base cPP supplies the DBMS foundation and assurance baseline. Crypto is the shared cryptographic layer. Cloud and DBaaS are alternative deployment overlays: Cloud assumes tenant operation; DBaaS assumes provider operation.</p>
        </div>
        <div class="module-digest-list">${visibleArtifacts.map(renderModuleDigest).join('')}</div>
      </section>

      <section class="guide-section" aria-labelledby="architecture-walkthrough-title">
        <div class="guide-section-heading">
          <div><p class="eyebrow">End-to-end walkthrough</p><h2 id="architecture-walkthrough-title">Security architecture lenses</h2></div>
          <p>Each lens states the architectural question, summarizes the division of responsibility, and links directly to the applicable SFRs and evaluation work for the selected PP-Configuration.</p>
        </div>
        <div class="architecture-workspace">
          <nav class="architecture-nav" aria-label="Security architecture lenses">${renderArchitectureNav(guide.architectureDomains)}</nav>
          <div id="architecture-domain-detail">${renderArchitectureDomain(domain)}</div>
        </div>
      </section>

      <section class="guide-section" aria-labelledby="arc-checkpoints-title">
        <div class="guide-section-heading">
          <div><p class="eyebrow">Formal assurance lens</p><h2 id="arc-checkpoints-title">What ADV_ARC.1 still has to prove</h2></div>
          <p>The modules add functional architecture and evaluation detail, but the parent Base cPP retains the formal Security Architecture Description requirement. These five checkpoints provide a concise completeness pass against its work units.</p>
        </div>
        <div class="arc-checkpoint-list">
          ${guide.arcReviewCheckpoints.map((checkpoint) => `
            <div class="arc-checkpoint">
              <code>${escapeHtml(checkpoint.workUnit)}</code>
              <strong>${escapeHtml(checkpoint.title)}</strong>
              <p>${escapeHtml(checkpoint.digest)}</p>
            </div>
          `).join('')}
        </div>
      </section>

      <section class="guide-handoff" aria-label="Continue to the requirements explorer">
        <div><h2>Ready for the requirement-level review?</h2><p>Use the same scope to inspect inclusion triggers, open operations, normative text, Supporting Document activities, and tests.</p></div>
        <button type="button" data-page-mode="explorer">Open Requirements Explorer</button>
      </section>
    `;
  }

  function matchingRequirements() {
    const modules = new Set(activeModules());
    const terms = state.query.toLowerCase().trim().split(/\s+/).filter(Boolean);
    return data.requirements.filter((requirement) => {
      if (!modules.has(requirement.owner)) return false;
      if (!state.categories.has(requirement.category)) return false;
      return terms.every((term) => requirement.searchText.includes(term));
    });
  }

  function renderOperation(operation) {
    return `
      <div class="operation ${operation.type === 'assignment' ? 'assignment' : ''}">
        <strong>${escapeHtml(operation.type)}</strong>
        <span>${escapeHtml(operation.text)}</span>
      </div>
    `;
  }

  function renderElement(element) {
    return `
      <div class="element">
        <div class="element-heading">
          <span class="element-kicker">Requirement element</span>
          <span class="element-id">${escapeHtml(element.id)}</span>
          ${element.operations.length ? `<span class="element-operation-count">${element.operations.length} open operation${element.operations.length === 1 ? '' : 's'}</span>` : ''}
        </div>
        <p class="source-text">${escapeHtml(element.text)}</p>
        ${element.operations.length ? `<div class="operation-list"><p class="operation-list-title">Open operations</p>${element.operations.map(renderOperation).join('')}</div>` : ''}
      </div>
    `;
  }

  function renderActivity(activity) {
    const owner = artifactById.get(activity.owner);
    return `
      <details class="activity" style="--owner-badge:${ownerColors[activity.owner]}">
        <summary class="activity-summary">
          <span class="activity-type">${escapeHtml(activity.type)}</span>
          <span class="activity-title">${escapeHtml(activity.title)}</span>
          <span class="activity-owner">${escapeHtml(owner?.shortLabel || activity.owner)}</span>
        </summary>
        <div class="activity-body">
          <p class="source-text">${escapeHtml(activity.text)}</p>
          <div class="source-links">${sourceButton(activity.source, 'Read SD', `${owner?.shortLabel || activity.owner}: ${activity.title}`)}</div>
        </div>
      </details>
    `;
  }

  function activeRelationships(relationships) {
    const modules = new Set(activeModules());
    return relationships.filter((relationship) => modules.has(relationship.owner));
  }

  function triggerJumpButton(uid, id, title, role, externalId = null) {
    const label = role === 'target' ? 'Included requirement' : 'Selection in';
    if (!uid) {
      const external = externalSourceById.get(externalId);
      return `
        <div class="trigger-endpoint ${escapeAttribute(role)} external">
          <span>${label}</span>
          <strong>${escapeHtml(id)}</strong>
          <small>${escapeHtml(external?.label || title)}</small>
        </div>
      `;
    }
    return `
      <button class="trigger-endpoint ${escapeAttribute(role)} js-jump-requirement" type="button" data-requirement-uid="${escapeAttribute(uid)}">
        <span>${label}</span>
        <strong>${escapeHtml(id)}</strong>
        <small>${escapeHtml(title)}</small>
      </button>
    `;
  }

  function renderTriggerFlow(trigger) {
    return `
      <div class="trigger-flow">
        ${triggerJumpButton(trigger.sourceUid, trigger.sourceId, trigger.sourceTitle, 'source')}
        <div class="trigger-connector ${escapeAttribute(trigger.kind || 'selection')}">
          <span class="trigger-condition-label">${escapeHtml(relationshipLabels[trigger.kind] || 'Inclusion condition')}</span>
          <span class="trigger-condition">${escapeHtml(trigger.condition)}</span>
          <span class="trigger-arrow" aria-hidden="true">-&gt;</span>
        </div>
        ${triggerJumpButton(trigger.targetUid, trigger.targetId, trigger.targetTitle, 'target', trigger.targetExternal)}
      </div>
    `;
  }

  function renderTriggerOverview(artifact, requirements) {
    const visibleUids = new Set(requirements.map(({ uid }) => uid));
    const globallyVisibleUids = new Set(matchingRequirements().map(({ uid }) => uid));
    const triggers = selectionTriggers.filter((trigger) => trigger.owner === artifact.id
      && visibleUids.has(trigger.sourceUid)
      && (!trigger.targetUid || globallyVisibleUids.has(trigger.targetUid)));
    if (!triggers.length) return '';
    return `
      <section class="trigger-overview" aria-label="Selection and dependency inclusions">
        <div class="trigger-overview-heading">
          <div>
            <span class="trigger-kicker">Inclusion logic</span>
            <h3>Triggered inclusions</h3>
          </div>
          <span class="trigger-count">${triggers.length} trigger${triggers.length === 1 ? '' : 's'}</span>
        </div>
        ${triggers.map(renderTriggerFlow).join('')}
      </section>
    `;
  }

  function renderTriggerSummary(requirement) {
    const outgoing = activeRelationships(triggersBySource.get(requirement.uid) || []);
    const incoming = activeRelationships(triggersByTarget.get(requirement.uid) || []);
    if (!outgoing.length && !incoming.length) return '';
    return `
      <span class="summary-trigger-list">
        ${outgoing.map((trigger) => `<span class="summary-trigger outgoing">Includes ${escapeHtml(trigger.targetId)}</span>`).join('')}
        ${incoming.map((trigger) => `<span class="summary-trigger incoming">Included by ${escapeHtml(trigger.sourceId)}</span>`).join('')}
      </span>
    `;
  }

  function renderTriggerDetails(requirement) {
    const outgoing = activeRelationships(triggersBySource.get(requirement.uid) || []);
    const incoming = activeRelationships(triggersByTarget.get(requirement.uid) || []);
    if (!outgoing.length && !incoming.length) return '';
    return `
      <section class="detail-section trigger-detail-section">
        <h3>Selection and dependency inclusions</h3>
        <div class="trigger-detail-list">
          ${outgoing.map((trigger) => `
            <div class="trigger-detail outgoing">
              <strong>${escapeHtml(relationshipLabels[trigger.kind] || 'Triggers inclusion of')}</strong>
              ${trigger.targetUid
                ? `<button class="trigger-detail-link js-jump-requirement" type="button" data-requirement-uid="${escapeAttribute(trigger.targetUid)}">${escapeHtml(trigger.targetId)}</button>`
                : `<span class="trigger-detail-link external">${escapeHtml(trigger.targetId)}</span>`}
              <span>${escapeHtml(trigger.condition)}</span>
            </div>
          `).join('')}
          ${incoming.map((trigger) => `
            <div class="trigger-detail incoming">
              <strong>Included by selection in</strong>
              <button class="trigger-detail-link js-jump-requirement" type="button" data-requirement-uid="${escapeAttribute(trigger.sourceUid)}">${escapeHtml(trigger.sourceId)}</button>
              <span>${escapeHtml(trigger.condition)}</span>
            </div>
          `).join('')}
        </div>
      </section>
    `;
  }

  function renderRequirement(requirement) {
    const artifact = artifactById.get(requirement.owner);
    const overlays = requirement.activitySources.filter((owner) => owner !== requirement.owner);
    const activityHtml = requirement.activities.length
      ? requirement.activities.map(renderActivity).join('')
      : `<p class="source-text">${requirement.category === 'catalogue'
        ? 'Algorithm-level evaluation remains with the external Catalogue methods. Any DBMS integration work is shown when defined locally.'
        : 'No requirement-specific local SD activity was matched by the generator.'}</p>`;
    const relations = requirement.related.length
      ? `<div class="relation-list">${requirement.related.map((id) => `<span class="badge">${escapeHtml(id)}</span>`).join('')}</div>`
      : '<p class="source-text">No direct SFR cross-reference appears in the requirement statement.</p>';
    return `
      <details class="requirement" id="${escapeAttribute(requirementDomId(requirement.uid))}" data-category="${escapeAttribute(requirement.category)}" data-has-selection-trigger="${triggersBySource.has(requirement.uid) || triggersByTarget.has(requirement.uid)}">
        <summary class="requirement-summary">
          <span aria-hidden="true"></span>
          <span class="requirement-id">${escapeHtml(requirement.id)}</span>
          <span class="requirement-title-block">
            <span class="requirement-title">${escapeHtml(requirement.title)}</span>
            ${renderTriggerSummary(requirement)}
            <span class="requirement-metrics">
              <span>${requirement.elements.length} element${requirement.elements.length === 1 ? '' : 's'}</span>
              <span>${requirement.operations.length} operation${requirement.operations.length === 1 ? '' : 's'}</span>
              <span>${requirement.activities.length} EA${requirement.activities.length === 1 ? '' : 's'}</span>
            </span>
          </span>
        </summary>
        <div class="requirement-body">
          <div class="meta-row" style="--type-color:${categoryColors[requirement.category]}">
            <span class="badge type">${escapeHtml(categoryLabels[requirement.category])}</span>
            <span class="badge">Owned by ${escapeHtml(artifact.shortLabel)}</span>
            ${overlays.map((owner) => `<span class="badge overlay" style="--owner-badge:${ownerColors[owner]}">${escapeHtml(artifactById.get(owner)?.shortLabel || owner)} overlay</span>`).join('')}
            <div class="source-links">
              ${sourceButton(requirement.source, 'Read PP', `${artifact.shortLabel}: ${requirement.id}`)}
              ${sourceButton({ url: artifact.sdUrl }, 'Read SD', `${artifact.shortLabel} Supporting Document`)}
            </div>
          </div>
          <div class="detail-grid">
            <div>
              ${renderTriggerDetails(requirement)}
              <section class="detail-section">
                <h3>Requirement elements and operations</h3>
                ${requirement.elements.length ? requirement.elements.map(renderElement).join('') : `<p class="source-text">${escapeHtml(requirement.title)}</p>`}
                ${requirement.completionText ? `<div class="completion-table"><h3>Retained Catalogue completions</h3><p class="source-text">${escapeHtml(requirement.completionText)}</p></div>` : ''}
              </section>
              <section class="detail-section">
                <h3>Direct requirement references</h3>
                ${relations}
              </section>
            </div>
            <section class="detail-section">
              <h3>Evaluation activities</h3>
              ${activityHtml}
            </section>
          </div>
        </div>
      </details>
    `;
  }

  function renderSupportItem(item, label) {
    const artifact = artifactById.get(item.owner);
    return `
      <details class="support-item" style="--owner-badge:${ownerColors[item.owner]}">
        <summary class="support-summary">
          <span aria-hidden="true"></span>
          <strong>${escapeHtml(item.title)}</strong>
          <span class="activity-owner">${escapeHtml(artifact.shortLabel)}</span>
        </summary>
        <div class="support-body">
          <p class="source-text">${escapeHtml(item.text)}</p>
          <div class="source-links">${sourceButton(item.source, label, `${artifact.shortLabel}: ${item.title}`)}</div>
        </div>
      </details>
    `;
  }

  function renderHierarchyRelations(requirement) {
    const outgoing = activeRelationships(triggersBySource.get(requirement.uid) || []);
    const incoming = activeRelationships(triggersByTarget.get(requirement.uid) || []);
    if (!outgoing.length && !incoming.length) return '';
    return `
      <div class="hierarchy-relations">
        ${outgoing.map((trigger) => `
          ${trigger.targetUid
            ? `<button class="hierarchy-relation outgoing js-jump-requirement" type="button" data-requirement-uid="${escapeAttribute(trigger.targetUid)}" title="${escapeAttribute(trigger.condition)}"><span aria-hidden="true">-&gt;</span> ${escapeHtml(trigger.targetId)}</button>`
            : `<span class="hierarchy-relation outgoing external" title="${escapeAttribute(trigger.condition)}"><span aria-hidden="true">-&gt;</span> ${escapeHtml(trigger.targetId)}</span>`}
        `).join('')}
        ${incoming.map((trigger) => `
          <button class="hierarchy-relation incoming js-jump-requirement" type="button" data-requirement-uid="${escapeAttribute(trigger.sourceUid)}" title="${escapeAttribute(trigger.condition)}">
            <span aria-hidden="true">&lt;-</span> ${escapeHtml(trigger.sourceId)}
          </button>
        `).join('')}
      </div>
    `;
  }

  function mindmapEndpointLabel(requirement, role, external) {
    if (external) return 'External requirements';
    if (requirement?.category === 'catalogue' && requirement.applicability === 'selection') return 'Triggered Catalogue SFR';
    if (requirement?.category === 'selection') return 'Selection-based SFR';
    if (requirement?.category === 'mandatory') return role === 'source' ? 'Mandatory SFR' : 'Cross-module SFR';
    return role === 'source' ? 'Triggering SFR' : 'Included requirement';
  }

  function graphTargetKey(trigger) {
    return trigger.targetUid || `external:${trigger.targetExternal}`;
  }

  function buildGraphNodes(triggers) {
    const nodes = new Map();
    for (const trigger of triggers) {
      const source = requirementByUid.get(trigger.sourceUid);
      if (source && !nodes.has(source.uid)) {
        nodes.set(source.uid, { ...source, key: source.uid, external: false });
      }
      const targetKey = graphTargetKey(trigger);
      if (nodes.has(targetKey)) continue;
      if (trigger.targetUid) {
        const target = requirementByUid.get(trigger.targetUid);
        if (target) nodes.set(targetKey, { ...target, key: targetKey, external: false });
      } else {
        const external = externalSourceById.get(trigger.targetExternal);
        nodes.set(targetKey, {
          key: targetKey,
          id: trigger.targetId,
          title: external?.label || trigger.targetTitle,
          owner: external?.owner || trigger.owner,
          category: 'external',
          applicability: 'external',
          external: true,
          externalId: trigger.targetExternal,
        });
      }
    }
    return nodes;
  }

  function stronglyConnectedComponents(nodeKeys, edges) {
    const adjacency = new Map(nodeKeys.map((key) => [key, []]));
    for (const edge of edges) adjacency.get(edge.source)?.push(edge.target);
    const indices = new Map();
    const lowLinks = new Map();
    const stack = [];
    const onStack = new Set();
    const components = [];
    let index = 0;

    function visit(key) {
      indices.set(key, index);
      lowLinks.set(key, index);
      index += 1;
      stack.push(key);
      onStack.add(key);
      for (const target of adjacency.get(key) || []) {
        if (!indices.has(target)) {
          visit(target);
          lowLinks.set(key, Math.min(lowLinks.get(key), lowLinks.get(target)));
        } else if (onStack.has(target)) {
          lowLinks.set(key, Math.min(lowLinks.get(key), indices.get(target)));
        }
      }
      if (lowLinks.get(key) !== indices.get(key)) return;
      const component = [];
      let member;
      do {
        member = stack.pop();
        onStack.delete(member);
        component.push(member);
      } while (member !== key);
      components.push(component);
    }

    for (const key of nodeKeys) if (!indices.has(key)) visit(key);
    return components;
  }

  function graphLayout(nodes, triggers) {
    const dimensions = {
      rootWidth: 220,
      artifactWidth: 160,
      nodeWidth: 220,
      nodeHeight: 94,
      nodeGap: 34,
      columnGap: 180,
      requirementStart: 570,
    };
    const edges = triggers.map((trigger, index) => ({
      index,
      source: trigger.sourceUid,
      target: graphTargetKey(trigger),
      trigger,
    }));
    const nodeKeys = [...nodes.keys()];
    const components = stronglyConnectedComponents(nodeKeys, edges);
    const componentByNode = new Map();
    components.forEach((component, componentIndex) => component.forEach((key) => componentByNode.set(key, componentIndex)));
    const componentEdges = new Map(components.map((_, index) => [index, new Set()]));
    const indegree = new Map(components.map((_, index) => [index, 0]));
    for (const edge of edges) {
      const source = componentByNode.get(edge.source);
      const target = componentByNode.get(edge.target);
      if (source === target || componentEdges.get(source).has(target)) continue;
      componentEdges.get(source).add(target);
      indegree.set(target, indegree.get(target) + 1);
    }
    const componentRanks = new Map(components.map((_, index) => [index, 0]));
    const queue = [...indegree.entries()].filter(([, count]) => count === 0).map(([index]) => index);
    while (queue.length) {
      const source = queue.shift();
      for (const target of componentEdges.get(source)) {
        componentRanks.set(target, Math.max(componentRanks.get(target), componentRanks.get(source) + 1));
        indegree.set(target, indegree.get(target) - 1);
        if (indegree.get(target) === 0) queue.push(target);
      }
    }
    const layers = new Map();
    for (const key of nodeKeys) {
      const rank = componentRanks.get(componentByNode.get(key));
      if (!layers.has(rank)) layers.set(rank, []);
      layers.get(rank).push(key);
    }
    const ownerOrder = new Map(data.artifacts.map((artifact, index) => [artifact.id, index]));
    const nodeSort = (a, b) => {
      const left = nodes.get(a);
      const right = nodes.get(b);
      return (ownerOrder.get(left.owner) ?? 99) - (ownerOrder.get(right.owner) ?? 99)
        || left.id.localeCompare(right.id, undefined, { numeric: true });
    };
    for (const layer of layers.values()) layer.sort(nodeSort);

    const layerIndexes = () => {
      const indexes = new Map();
      for (const layer of layers.values()) {
        const divisor = Math.max(1, layer.length - 1);
        layer.forEach((key, index) => indexes.set(key, index / divisor));
      }
      return indexes;
    };
    const incoming = new Map(nodeKeys.map((key) => [key, []]));
    const outgoing = new Map(nodeKeys.map((key) => [key, []]));
    for (const edge of edges) {
      incoming.get(edge.target).push(edge.source);
      outgoing.get(edge.source).push(edge.target);
    }
    const sortedRanks = [...layers.keys()].sort((a, b) => a - b);
    for (let pass = 0; pass < 4; pass += 1) {
      let indexes = layerIndexes();
      for (const rank of sortedRanks.slice(1)) {
        layers.get(rank).sort((a, b) => {
          const average = (key, neighbors) => neighbors.get(key).length
            ? neighbors.get(key).reduce((sum, item) => sum + (indexes.get(item) ?? .5), 0) / neighbors.get(key).length
            : indexes.get(key);
          return average(a, incoming) - average(b, incoming) || nodeSort(a, b);
        });
      }
      indexes = layerIndexes();
      for (const rank of [...sortedRanks].reverse().slice(1)) {
        layers.get(rank).sort((a, b) => {
          const average = (key) => outgoing.get(key).length
            ? outgoing.get(key).reduce((sum, item) => sum + (indexes.get(item) ?? .5), 0) / outgoing.get(key).length
            : indexes.get(key);
          return average(a) - average(b) || nodeSort(a, b);
        });
      }
    }

    const maxLayerCount = Math.max(...[...layers.values()].map((layer) => layer.length));
    const graphHeight = Math.max(920, maxLayerCount * (dimensions.nodeHeight + dimensions.nodeGap) + 120);
    const positions = new Map();
    for (const [rank, layer] of layers) {
      const available = graphHeight - dimensions.nodeHeight - 100;
      layer.forEach((key, index) => {
        const y = layer.length === 1 ? available / 2 + 50 : 50 + (available * index) / (layer.length - 1);
        positions.set(key, {
          x: dimensions.requirementStart + rank * (dimensions.nodeWidth + dimensions.columnGap),
          y,
          width: dimensions.nodeWidth,
          height: dimensions.nodeHeight,
          rank,
        });
      });
    }
    const maxRank = Math.max(...sortedRanks);
    const graphWidth = dimensions.requirementStart + (maxRank + 1) * dimensions.nodeWidth + maxRank * dimensions.columnGap + 100;
    return { dimensions, edges, graphHeight, graphWidth, incoming, outgoing, positions };
  }

  function graphPath(source, target, sameLayer = false) {
    const sourceX = source.x + source.width;
    const sourceY = source.y + source.height / 2;
    const targetY = target.y + target.height / 2;
    if (sameLayer) {
      const loopX = sourceX + 72;
      return `M ${sourceX} ${sourceY} C ${loopX} ${sourceY}, ${loopX} ${targetY}, ${target.x + target.width} ${targetY}`;
    }
    const targetX = target.x;
    const middle = sourceX + (targetX - sourceX) / 2;
    return `M ${sourceX} ${sourceY} C ${middle} ${sourceY}, ${middle} ${targetY}, ${targetX} ${targetY}`;
  }

  function graphStructurePath(source, target) {
    const sourceX = source.x + source.width;
    const sourceY = source.y + source.height / 2;
    const targetY = target.y + target.height / 2;
    const middle = sourceX + (target.x - sourceX) / 2;
    return `M ${sourceX} ${sourceY} C ${middle} ${sourceY}, ${middle} ${targetY}, ${target.x} ${targetY}`;
  }

  function renderGraphNode(node, position) {
    const requirement = node.external ? null : requirementByUid.get(node.uid);
    const external = node.external ? externalSourceById.get(node.externalId) : null;
    const roleLabel = mindmapEndpointLabel(requirement, requirement?.category === 'mandatory' ? 'source' : 'target', external);
    const color = node.external ? categoryColors.selection : categoryColors[node.category];
    const body = `<span>${roleLabel}</span><strong>${escapeHtml(node.id)}</strong><small>${escapeHtml(node.title)}</small>`;
    const style = `left:${position.x}px;top:${position.y}px;width:${position.width}px;min-height:${position.height}px;--type-color:${color};--owner-color:${ownerColors[node.owner] || color}`;
    if (node.external) {
      return `<div class="graph-requirement-node external" data-graph-node="${escapeAttribute(node.key)}" style="${style}" tabindex="0" role="group" aria-label="${escapeAttribute(`${roleLabel} ${node.id} ${node.title}`)}">${body}</div>`;
    }
    return `<div class="graph-requirement-node" data-graph-node="${escapeAttribute(node.key)}" style="${style}" tabindex="0" role="group" aria-label="${escapeAttribute(`${roleLabel} ${node.id} ${node.title}`)}">${body}<button class="graph-open-requirement js-jump-requirement" data-requirement-uid="${escapeAttribute(node.uid)}" type="button" title="Open ${escapeAttribute(node.id)} in the detailed outline" aria-label="Open ${escapeAttribute(node.id)} in the detailed outline">&gt;</button></div>`;
  }

  function renderGraphFocusPanel(triggers, nodes, focusedKey = null) {
    if (!focusedKey || !nodes.has(focusedKey)) {
      const counts = triggers.reduce((summary, trigger) => ({ ...summary, [trigger.kind]: (summary[trigger.kind] || 0) + 1 }), {});
      return `
        <div class="graph-focus-title"><strong>${nodes.size} unique nodes</strong><span>${triggers.length} inclusion relationships</span></div>
        <div class="graph-kind-summary">
          <span class="selection">${counts.selection || 0} selection inclusions</span>
          <span class="cascade">${counts.cascade || 0} dependency cascades</span>
          <span class="package">${counts.package || 0} package relationships</span>
        </div>
      `;
    }
    const node = nodes.get(focusedKey);
    const related = triggers.filter((trigger) => trigger.sourceUid === focusedKey || graphTargetKey(trigger) === focusedKey);
    return `
      <div class="graph-focus-title"><strong>${escapeHtml(node.id)}</strong><span>${escapeHtml(node.title)}</span></div>
      <div class="graph-focus-relations">
        ${related.map((trigger) => `
          <div class="graph-focus-relation ${escapeAttribute(trigger.kind || 'selection')}">
            <span>${escapeHtml(trigger.sourceId)} -&gt; ${escapeHtml(trigger.targetId)}</span>
            <strong>${escapeHtml(trigger.condition)}</strong>
          </div>
        `).join('')}
      </div>
    `;
  }

  function renderGraphEdgeFocusPanel(trigger) {
    return `
      <div class="graph-focus-title"><strong>${escapeHtml(`${trigger.sourceId} -> ${trigger.targetId}`)}</strong><span>${escapeHtml(relationshipLabels[trigger.kind] || 'Inclusion relationship')}</span></div>
      <div class="graph-focus-relations">
        <div class="graph-focus-relation ${escapeAttribute(trigger.kind || 'selection')}">
          <span>${escapeHtml(trigger.sourceTitle)} -&gt; ${escapeHtml(trigger.targetTitle)}</span>
          <strong>${escapeHtml(trigger.condition)}</strong>
        </div>
      </div>
    `;
  }

  function renderTriggerMindMap(triggers, requirementCount) {
    const configuration = activeConfiguration();
    const label = configuration?.label || 'All review artifacts';
    const nodes = buildGraphNodes(triggers);
    const layout = graphLayout(nodes, triggers);
    const activeArtifacts = data.artifacts.filter((artifact) => [...nodes.values()].some((node) => node.owner === artifact.id));
    const rootPosition = { x: 20, y: layout.graphHeight / 2 - 50, width: layout.dimensions.rootWidth, height: 100 };
    const artifactPositions = new Map(activeArtifacts.map((artifact, index) => [artifact.id, {
      x: 310,
      y: ((index + 1) * layout.graphHeight) / (activeArtifacts.length + 1) - 40,
      width: layout.dimensions.artifactWidth,
      height: 80,
    }]));
    const rootNodeKeys = [...nodes.keys()].filter((key) => layout.incoming.get(key).length === 0);
    const structuralEdges = [
      ...activeArtifacts.map((artifact) => ({
        source: rootPosition,
        target: artifactPositions.get(artifact.id),
        owner: artifact.id,
      })),
      ...rootNodeKeys.map((key) => ({
        source: artifactPositions.get(nodes.get(key).owner),
        target: layout.positions.get(key),
        owner: nodes.get(key).owner,
      })).filter(({ source }) => source),
    ];
    const artifactCounts = new Map(activeArtifacts.map((artifact) => [artifact.id, triggers.filter((trigger) => trigger.owner === artifact.id).length]));
    const renderedEdges = layout.edges.map((edge) => {
      const source = layout.positions.get(edge.source);
      const target = layout.positions.get(edge.target);
      return {
        ...edge,
        kind: edge.trigger.kind || 'selection',
        path: graphPath(source, target, source.rank === target.rank),
      };
    });
    window.DBMS_REQUIREMENTS_GRAPH = { triggers, nodes };
    return `
      <section class="inclusion-graph" aria-label="Selection and dependency inclusion graph">
        <div class="graph-focus-panel" aria-live="polite">${renderGraphFocusPanel(triggers, nodes)}</div>
        <div class="graph-canvas" style="width:${layout.graphWidth}px;height:${layout.graphHeight}px">
          <svg class="graph-edges" viewBox="0 0 ${layout.graphWidth} ${layout.graphHeight}" aria-label="Requirement inclusion connectors">
            <defs>
              <marker id="graph-arrow-selection" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z"></path></marker>
              <marker id="graph-arrow-cascade" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z"></path></marker>
              <marker id="graph-arrow-package" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z"></path></marker>
            </defs>
            ${structuralEdges.map((edge) => `<path class="graph-structure-edge" style="--edge-color:${ownerColors[edge.owner]}" d="${graphStructurePath(edge.source, edge.target)}"></path>`).join('')}
            ${renderedEdges.map((edge) => `<path class="graph-edge-lane ${escapeAttribute(edge.kind)}" data-graph-edge="${edge.index}" data-graph-source="${escapeAttribute(edge.source)}" data-graph-target="${escapeAttribute(edge.target)}" d="${edge.path}" aria-hidden="true"></path>`).join('')}
            ${renderedEdges.map((edge) => `<path class="graph-edge ${escapeAttribute(edge.kind)}" data-graph-edge="${edge.index}" data-graph-source="${escapeAttribute(edge.source)}" data-graph-target="${escapeAttribute(edge.target)}" d="${edge.path}" marker-end="url(#graph-arrow-${escapeAttribute(edge.kind)})"><title>${escapeHtml(`${edge.trigger.sourceId} -> ${edge.trigger.targetId}: ${edge.trigger.condition}`)}</title></path>`).join('')}
            ${renderedEdges.map((edge) => `<path class="graph-edge-hit" data-graph-edge="${edge.index}" data-graph-source="${escapeAttribute(edge.source)}" data-graph-target="${escapeAttribute(edge.target)}" d="${edge.path}" aria-hidden="true"></path>`).join('')}
          </svg>
          <div class="graph-root-node" style="left:${rootPosition.x}px;top:${rootPosition.y}px;width:${rootPosition.width}px;min-height:${rootPosition.height}px">
            <span>PP-Configuration</span><strong>${escapeHtml(label)}</strong><small>${requirementCount} mapped requirements / ${triggers.length} relationships</small>
          </div>
          ${activeArtifacts.map((artifact) => {
            const position = artifactPositions.get(artifact.id);
            return `<div class="graph-artifact-node" style="left:${position.x}px;top:${position.y}px;width:${position.width}px;min-height:${position.height}px;--owner-color:${ownerColors[artifact.id]}"><span>Artifact</span><strong>${escapeHtml(artifact.shortLabel)}</strong><small>${artifactCounts.get(artifact.id)} relationships</small></div>`;
          }).join('')}
          ${[...nodes.values()].map((node) => renderGraphNode(node, layout.positions.get(node.key))).join('')}
        </div>
      </section>
    `;
  }

  function renderHierarchyRequirement(requirement) {
    return `
      <div class="hierarchy-sfr-node" style="--type-color:${categoryColors[requirement.category]}" data-category="${escapeAttribute(requirement.category)}">
        <button class="hierarchy-sfr-main js-jump-requirement" type="button" data-requirement-uid="${escapeAttribute(requirement.uid)}" title="Open ${escapeAttribute(requirement.id)} in the detailed outline">
          <span class="hierarchy-sfr-topline">
            <strong>${escapeHtml(requirement.id)}</strong>
            <span>${escapeHtml(categoryLabels[requirement.category])}</span>
          </span>
          <span class="hierarchy-sfr-title">${escapeHtml(requirement.title)}</span>
          <span class="hierarchy-sfr-metrics">${requirement.elements.length} el / ${requirement.operations.length} op / ${requirement.activities.length} EA</span>
        </button>
        ${renderHierarchyRelations(requirement)}
      </div>
    `;
  }

  function renderHierarchyClass(className, requirements) {
    return `
      <details class="hierarchy-class-branch" open>
        <summary class="hierarchy-class-node">
          <span class="hierarchy-disclosure" aria-hidden="true"></span>
          <span>
            <strong>${escapeHtml(className)} class</strong>
            <small>${requirements.length} requirement${requirements.length === 1 ? '' : 's'}</small>
          </span>
        </summary>
        <div class="hierarchy-sfr-list">
          ${requirements.map(renderHierarchyRequirement).join('')}
        </div>
      </details>
    `;
  }

  function renderHierarchyArtifact(artifact, requirements) {
    const byClass = new Map();
    for (const requirement of requirements) {
      if (!byClass.has(requirement.class)) byClass.set(requirement.class, []);
      byClass.get(requirement.class).push(requirement);
    }
    const classes = [...byClass.entries()].sort(([a], [b]) => {
      const assuranceOrder = Number(assuranceClasses.has(a)) - Number(assuranceClasses.has(b));
      return assuranceOrder || a.localeCompare(b);
    });
    return `
      <details class="hierarchy-artifact-branch" style="--owner-color:${ownerColors[artifact.id]}" open>
        <summary class="hierarchy-artifact-node">
          <span class="hierarchy-disclosure" aria-hidden="true"></span>
          <span>
            <strong>${escapeHtml(artifact.shortLabel)}</strong>
            <small>${escapeHtml(artifact.label)}</small>
          </span>
          <span class="hierarchy-node-count">${requirements.length}</span>
        </summary>
        <div class="hierarchy-class-list">
          ${classes.map(([className, members]) => renderHierarchyClass(className, members)).join('')}
        </div>
      </details>
    `;
  }

  function renderHierarchy(artifacts, grouped, requirementCount) {
    const configuration = activeConfiguration();
    const label = configuration?.label || 'All review artifacts';
    const minWidth = Math.max(760, artifacts.length * 300);
    const edgeOffset = artifacts.length ? 50 / artifacts.length : 50;
    return `
      <section class="hierarchy-chart" aria-label="Requirement hierarchy" style="--artifact-count:${artifacts.length};--hierarchy-min-width:${minWidth}px;--edge-offset:${edgeOffset}%">
        <div class="hierarchy-root-row">
          <div class="hierarchy-root-node">
            <span>PP-Configuration</span>
            <strong>${escapeHtml(label)}</strong>
            <small>${requirementCount} requirements / ${artifacts.length} artifacts</small>
          </div>
        </div>
        <div class="hierarchy-root-stem" aria-hidden="true"></div>
        <div class="hierarchy-artifacts">
          ${artifacts.map((artifact) => renderHierarchyArtifact(artifact, grouped.get(artifact.id))).join('')}
        </div>
      </section>
    `;
  }

  function renderArtifact(artifact, requirements) {
    const byClass = new Map();
    for (const requirement of requirements) {
      if (!byClass.has(requirement.class)) byClass.set(requirement.class, []);
      byClass.get(requirement.class).push(requirement);
    }
    const classes = [...byClass.entries()].sort(([a], [b]) => a.localeCompare(b));
    const classHtml = classes.map(([className, members]) => `
      <details class="class-group" open>
        <summary class="class-summary">
          <span aria-hidden="true"></span>
          <span>${escapeHtml(className)} class</span>
          <span class="summary-count">${members.length}</span>
        </summary>
        <div class="class-body">${members.map(renderRequirement).join('')}</div>
      </details>
    `).join('');

    const profiles = data.profiles.filter((item) => item.owner === artifact.id);
    const guidance = data.guidance.filter((item) => item.owner === artifact.id);
    const supportHtml = [
      profiles.length ? `<section class="support-section"><h3>Use cases and selection profiles</h3>${profiles.map((item) => renderSupportItem(item, 'Read PP')).join('')}</section>` : '',
      guidance.length ? `<section class="support-section"><h3>Cross-cutting evaluator guidance</h3>${guidance.map((item) => renderSupportItem(item, 'Read SD')).join('')}</section>` : '',
    ].join('');

    return `
      <details class="artifact-group" data-owner="${escapeAttribute(artifact.id)}" open>
        <summary class="artifact-summary">
          <span aria-hidden="true"></span>
          <h2>${escapeHtml(artifact.label)}</h2>
          <span class="summary-count">${requirements.length} mapped requirement${requirements.length === 1 ? '' : 's'}</span>
        </summary>
        <div class="artifact-body">
          ${renderTriggerOverview(artifact, requirements)}
          ${classHtml}
          ${supportHtml}
        </div>
      </details>
    `;
  }

  function setGraphFocus(nodeKey, pin = false) {
    const graph = elements.map.querySelector('.inclusion-graph');
    const graphData = window.DBMS_REQUIREMENTS_GRAPH;
    if (!graph || !graphData?.nodes.has(nodeKey)) return;
    if ((graph.dataset.pinnedNode || graph.dataset.pinnedEdge) && !pin && graph.dataset.pinnedNode !== nodeKey) return;
    if (pin) {
      graph.dataset.pinnedNode = nodeKey;
      delete graph.dataset.pinnedEdge;
    }
    const relatedKeys = new Set([nodeKey]);
    for (const trigger of graphData.triggers) {
      const targetKey = graphTargetKey(trigger);
      if (trigger.sourceUid === nodeKey) relatedKeys.add(targetKey);
      if (targetKey === nodeKey) relatedKeys.add(trigger.sourceUid);
    }
    graph.querySelectorAll('.graph-requirement-node').forEach((node) => {
      node.classList.toggle('is-focused', node.dataset.graphNode === nodeKey);
      node.classList.toggle('is-related', relatedKeys.has(node.dataset.graphNode) && node.dataset.graphNode !== nodeKey);
      node.classList.toggle('is-dimmed', !relatedKeys.has(node.dataset.graphNode));
    });
    graph.querySelectorAll('.graph-edge').forEach((edge) => {
      const related = edge.dataset.graphSource === nodeKey || edge.dataset.graphTarget === nodeKey;
      edge.classList.toggle('is-related', related);
      edge.classList.toggle('is-dimmed', !related);
    });
    graph.querySelectorAll('.graph-edge-lane').forEach((lane) => {
      lane.classList.toggle('is-related', lane.dataset.graphSource === nodeKey || lane.dataset.graphTarget === nodeKey);
    });
    const panel = graph.querySelector('.graph-focus-panel');
    if (panel) panel.innerHTML = renderGraphFocusPanel(graphData.triggers, graphData.nodes, nodeKey);
  }

  function setGraphEdgeFocus(edgeIndex, pin = false) {
    const graph = elements.map.querySelector('.inclusion-graph');
    const graphData = window.DBMS_REQUIREMENTS_GRAPH;
    const trigger = graphData?.triggers[edgeIndex];
    if (!graph || !trigger) return;
    if ((graph.dataset.pinnedNode || graph.dataset.pinnedEdge) && !pin && graph.dataset.pinnedEdge !== String(edgeIndex)) return;
    if (pin) {
      graph.dataset.pinnedEdge = String(edgeIndex);
      delete graph.dataset.pinnedNode;
    }
    const sourceKey = trigger.sourceUid;
    const targetKey = graphTargetKey(trigger);
    graph.querySelectorAll('.graph-requirement-node').forEach((node) => {
      const endpoint = node.dataset.graphNode === sourceKey || node.dataset.graphNode === targetKey;
      node.classList.toggle('is-edge-endpoint', endpoint);
      node.classList.toggle('is-dimmed', !endpoint);
    });
    graph.querySelectorAll('.graph-edge').forEach((edge) => {
      const related = edge.dataset.graphEdge === String(edgeIndex);
      edge.classList.toggle('is-related', related);
      edge.classList.toggle('is-dimmed', !related);
    });
    graph.querySelectorAll('.graph-edge-lane').forEach((lane) => {
      lane.classList.toggle('is-related', lane.dataset.graphEdge === String(edgeIndex));
    });
    const panel = graph.querySelector('.graph-focus-panel');
    if (panel) panel.innerHTML = renderGraphEdgeFocusPanel(trigger);
  }

  function clearGraphFocus(force = false) {
    const graph = elements.map.querySelector('.inclusion-graph');
    const graphData = window.DBMS_REQUIREMENTS_GRAPH;
    if (!graph || !graphData) return;
    if ((graph.dataset.pinnedNode || graph.dataset.pinnedEdge) && !force) return;
    delete graph.dataset.pinnedNode;
    delete graph.dataset.pinnedEdge;
    graph.querySelectorAll('.is-focused, .is-related, .is-dimmed, .is-edge-endpoint').forEach((element) => {
      element.classList.remove('is-focused', 'is-related', 'is-dimmed', 'is-edge-endpoint');
    });
    const panel = graph.querySelector('.graph-focus-panel');
    if (panel) panel.innerHTML = renderGraphFocusPanel(graphData.triggers, graphData.nodes);
  }

  function renderMap() {
    const candidateMatches = matchingRequirements();
    const modules = activeModules();
    let visibleTriggers = [];
    let matches = candidateMatches;
    if (state.view === 'triggers') {
      const candidateEndpointUids = new Set(candidateMatches
        .filter((requirement) => triggerEndpointUids.has(requirement.uid))
        .map((requirement) => requirement.uid));
      visibleTriggers = selectionTriggers.filter((trigger) => modules.includes(trigger.owner)
        && candidateEndpointUids.has(trigger.sourceUid)
        && (!trigger.targetUid || candidateEndpointUids.has(trigger.targetUid)));
      const visibleEndpointUids = new Set(visibleTriggers.flatMap((trigger) => [trigger.sourceUid, trigger.targetUid]).filter(Boolean));
      matches = candidateMatches.filter((requirement) => visibleEndpointUids.has(requirement.uid));
    }
    const grouped = new Map(modules.map((owner) => [owner, []]));
    for (const requirement of matches) grouped.get(requirement.owner)?.push(requirement);
    const visibleArtifacts = data.artifacts.filter((artifact) => grouped.has(artifact.id) && grouped.get(artifact.id).length);
    elements.map.classList.toggle('hierarchy-mode', state.view === 'hierarchy');
    elements.map.classList.toggle('trigger-mode', state.view === 'triggers');
    elements.map.innerHTML = matches.length === 0
      ? ''
      : state.view === 'triggers'
        ? renderTriggerMindMap(visibleTriggers, matches.length)
        : state.view === 'hierarchy'
          ? renderHierarchy(visibleArtifacts, grouped, matches.length)
          : visibleArtifacts.map((artifact) => renderArtifact(artifact, grouped.get(artifact.id))).join('');
    elements.empty.hidden = matches.length !== 0;

    const totals = matches.reduce((summary, requirement) => ({
      elements: summary.elements + requirement.elements.length,
      operations: summary.operations + requirement.operations.length,
      activities: summary.activities + requirement.activities.length,
      tests: summary.tests + requirement.testCount,
    }), { elements: 0, operations: 0, activities: 0, tests: 0 });
    const visibleUids = new Set(matches.map(({ uid }) => uid));
    const visibleTriggerCount = state.view === 'triggers'
      ? visibleTriggers.length
      : selectionTriggers.filter((trigger) => visibleUids.has(trigger.sourceUid) && (!trigger.targetUid || visibleUids.has(trigger.targetUid))).length;
    elements.summary.innerHTML = `<strong>${matches.length}</strong> requirements &nbsp; <strong>${visibleTriggerCount}</strong> inclusion relationships &nbsp; <strong>${totals.elements}</strong> elements &nbsp; <strong>${totals.operations}</strong> open operations &nbsp; <strong>${totals.activities}</strong> evaluation activities &nbsp; <strong>${totals.tests}</strong> tests`;
    openHashTarget();
  }

  function setPageMode(mode) {
    if (mode !== 'guide' && mode !== 'explorer') return;
    state.page = mode;
    if (mode === 'guide') {
      if (!elements.reader.hidden) closeReader();
      if (location.hash.startsWith('#req-')) history.replaceState(null, '', `${location.pathname}${location.search}`);
    }
    renderPageModeControl();
    if (mode === 'explorer') renderMap();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function jumpToRequirement(uid) {
    const requirement = requirementByUid.get(uid);
    if (!requirement) return;
    state.page = 'explorer';
    renderPageModeControl();
    if (state.view !== 'outline') {
      state.view = 'outline';
      renderViewControl();
      renderMap();
    }
    let target = document.getElementById(requirementDomId(uid));
    if (!target) {
      state.query = '';
      state.categories.add(requirement.category);
      elements.search.value = '';
      renderTypeFilters();
      renderMap();
      target = document.getElementById(requirementDomId(uid));
    }
    if (!target) return;
    let current = target;
    while (current) {
      if (current.tagName === 'DETAILS') current.open = true;
      current = current.parentElement;
    }
    history.replaceState(null, '', `#${target.id}`);
    requestAnimationFrame(() => target.scrollIntoView({ block: 'center' }));
  }

  function openSource(url, title) {
    elements.reader.hidden = false;
    elements.readerResizer.hidden = false;
    elements.workspace.classList.add('reader-open');
    elements.readerTitle.textContent = title || 'Source document';
    elements.readerFrame.src = url;
    elements.readerNewWindow.href = url;
  }

  function closeReader() {
    elements.reader.hidden = true;
    elements.readerResizer.hidden = true;
    elements.workspace.classList.remove('reader-open');
    elements.readerFrame.src = 'about:blank';
  }

  function readerWidthBounds() {
    const workspaceWidth = elements.workspace.getBoundingClientRect().width;
    return {
      min: 360,
      max: Math.max(360, Math.min(900, workspaceWidth - 560)),
    };
  }

  function setReaderWidth(width) {
    const { min, max } = readerWidthBounds();
    const value = Math.round(Math.max(min, Math.min(max, width)));
    document.documentElement.style.setProperty('--reader-width', `${value}px`);
    elements.readerResizer.setAttribute('aria-valuemin', String(min));
    elements.readerResizer.setAttribute('aria-valuemax', String(max));
    elements.readerResizer.setAttribute('aria-valuenow', String(value));
    try { localStorage.setItem('dbms-requirements-reader-width', String(value)); } catch (_) { /* Storage is optional. */ }
  }

  function setZoom(value) {
    state.zoom = Math.max(.7, Math.min(1.5, value));
    document.documentElement.style.setProperty('--map-scale', state.zoom);
    elements.zoomValue.value = `${Math.round(state.zoom * 100)}%`;
    elements.zoomValue.textContent = elements.zoomValue.value;
  }

  function openHashTarget() {
    if (!location.hash.startsWith('#req-')) return;
    const target = document.querySelector(location.hash);
    if (!target) return;
    let current = target;
    while (current) {
      if (current.tagName === 'DETAILS') current.open = true;
      current = current.parentElement;
    }
    requestAnimationFrame(() => target.scrollIntoView({ block: 'center' }));
  }

  function rerender() {
    renderPageModeControl();
    renderConfigurationControl();
    renderComposition();
    renderViewControl();
    renderReaderGuide();
    renderMap();
  }

  elements.pageModeControl.addEventListener('click', (event) => {
    const button = event.target.closest('[data-page-mode]');
    if (!button) return;
    setPageMode(button.dataset.pageMode);
  });

  elements.configurationControl.addEventListener('click', (event) => {
    const button = event.target.closest('[data-configuration]');
    if (!button) return;
    state.configuration = button.dataset.configuration;
    rerender();
  });

  elements.guide.addEventListener('click', (event) => {
    const pageButton = event.target.closest('[data-page-mode]');
    if (pageButton) {
      setPageMode(pageButton.dataset.pageMode);
      return;
    }
    const domainButton = event.target.closest('[data-architecture-domain]');
    if (domainButton) {
      state.architectureDomain = domainButton.dataset.architectureDomain;
      renderReaderGuide();
      requestAnimationFrame(() => document.getElementById('architecture-domain-detail')?.scrollIntoView({ block: 'nearest' }));
      return;
    }
    const requirementButton = event.target.closest('.js-jump-requirement');
    if (requirementButton) jumpToRequirement(requirementButton.dataset.requirementUid);
  });

  elements.viewControl.addEventListener('click', (event) => {
    const button = event.target.closest('[data-view]');
    if (!button) return;
    state.view = button.dataset.view;
    renderViewControl();
    renderMap();
  });

  elements.typeFilters.addEventListener('change', (event) => {
    const checkbox = event.target.closest('input[type="checkbox"]');
    if (!checkbox) return;
    if (checkbox.checked) state.categories.add(checkbox.value);
    else state.categories.delete(checkbox.value);
    renderMap();
  });

  elements.search.addEventListener('input', () => {
    state.query = elements.search.value;
    renderMap();
  });

  elements.map.addEventListener('click', (event) => {
    const triggerJump = event.target.closest('.js-jump-requirement');
    if (triggerJump) {
      event.preventDefault();
      jumpToRequirement(triggerJump.dataset.requirementUid);
      return;
    }
    const graphEdge = event.target.closest('.graph-edge-hit');
    if (graphEdge) {
      const graph = graphEdge.closest('.inclusion-graph');
      const isPinned = graph?.dataset.pinnedEdge === graphEdge.dataset.graphEdge;
      if (isPinned) clearGraphFocus(true);
      else setGraphEdgeFocus(Number(graphEdge.dataset.graphEdge), true);
      return;
    }
    const graphNode = event.target.closest('.graph-requirement-node');
    if (graphNode) {
      const graph = graphNode.closest('.inclusion-graph');
      const isPinned = graph?.dataset.pinnedNode === graphNode.dataset.graphNode;
      if (isPinned) clearGraphFocus(true);
      else setGraphFocus(graphNode.dataset.graphNode, true);
      return;
    }
    const source = event.target.closest('.js-read-source');
    if (source) {
      event.preventDefault();
      openSource(source.dataset.url, source.dataset.title);
    }
  });

  elements.map.addEventListener('pointerover', (event) => {
    const edge = event.target.closest('.graph-edge-hit');
    if (edge) {
      setGraphEdgeFocus(Number(edge.dataset.graphEdge));
      return;
    }
    const node = event.target.closest('.graph-requirement-node');
    if (node) setGraphFocus(node.dataset.graphNode);
  });

  elements.map.addEventListener('pointerout', (event) => {
    const edge = event.target.closest('.graph-edge-hit');
    if (edge) {
      clearGraphFocus();
      return;
    }
    const node = event.target.closest('.graph-requirement-node');
    if (!node || node.contains(event.relatedTarget)) return;
    clearGraphFocus();
  });

  elements.map.addEventListener('focusin', (event) => {
    const node = event.target.closest('.graph-requirement-node');
    if (node) setGraphFocus(node.dataset.graphNode);
  });

  elements.map.addEventListener('focusout', (event) => {
    const node = event.target.closest('.graph-requirement-node');
    if (!node || node.contains(event.relatedTarget)) return;
    clearGraphFocus();
  });

  elements.map.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const node = event.target.closest('.graph-requirement-node');
    if (!node || event.target.closest('.graph-open-requirement')) return;
    event.preventDefault();
    const graph = node.closest('.inclusion-graph');
    const isPinned = graph?.dataset.pinnedNode === node.dataset.graphNode;
    if (isPinned) clearGraphFocus(true);
    else setGraphFocus(node.dataset.graphNode, true);
  });

  elements.map.addEventListener('toggle', (event) => {
    if (!event.target.classList?.contains('requirement') || !event.target.open) return;
    history.replaceState(null, '', `#${event.target.id}`);
  }, true);

  document.getElementById('zoom-out').addEventListener('click', () => setZoom(state.zoom - .1));
  document.getElementById('zoom-in').addEventListener('click', () => setZoom(state.zoom + .1));
  document.getElementById('expand-all').addEventListener('click', () => elements.map.querySelectorAll('details').forEach((detail) => { detail.open = true; }));
  document.getElementById('collapse-all').addEventListener('click', () => elements.map.querySelectorAll('details').forEach((detail) => { detail.open = false; }));
  document.getElementById('reader-close').addEventListener('click', closeReader);
  elements.readerResizer.addEventListener('pointerdown', (event) => {
    if (window.matchMedia('(max-width: 1050px)').matches) return;
    event.preventDefault();
    elements.readerResizer.setPointerCapture(event.pointerId);
    const resize = (moveEvent) => setReaderWidth(elements.workspace.getBoundingClientRect().right - moveEvent.clientX);
    const finish = () => {
      elements.readerResizer.removeEventListener('pointermove', resize);
      elements.readerResizer.removeEventListener('pointerup', finish);
      elements.readerResizer.removeEventListener('pointercancel', finish);
    };
    elements.readerResizer.addEventListener('pointermove', resize);
    elements.readerResizer.addEventListener('pointerup', finish);
    elements.readerResizer.addEventListener('pointercancel', finish);
  });
  elements.readerResizer.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const current = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--reader-width')) || 560;
    setReaderWidth(current + (event.key === 'ArrowLeft' ? 24 : -24));
  });
  document.getElementById('clear-filters').addEventListener('click', () => {
    state.query = '';
    state.categories = new Set(Object.keys(categoryLabels));
    elements.search.value = '';
    renderTypeFilters();
    renderMap();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (!elements.reader.hidden) closeReader();
    else clearGraphFocus(true);
  });

  renderTypeFilters();
  try {
    const savedReaderWidth = Number(localStorage.getItem('dbms-requirements-reader-width'));
    if (Number.isFinite(savedReaderWidth)) setReaderWidth(savedReaderWidth);
  } catch (_) { /* Storage is optional. */ }
  renderLegend();
  setZoom(1);
  rerender();
})();
