/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as DOM from 'vs/base/browser/dom';
import { StandardKeyboardEvent } from 'vs/base/browser/keyboardEvent';
import { Checkbox } from 'vs/base/browser/ui/checkbox/checkbox';
import { InputBox } from 'vs/base/browser/ui/inputbox/inputBox';
import { IDelegate, IRenderer } from 'vs/base/browser/ui/list/list';
import { List } from 'vs/base/browser/ui/list/listWidget';
import { SelectBox } from 'vs/base/browser/ui/selectBox/selectBox';
import { IAction } from 'vs/base/common/actions';
import { Delayer } from 'vs/base/common/async';
import { Color } from 'vs/base/common/color';
import { Emitter, Event } from 'vs/base/common/event';
import { KeyCode } from 'vs/base/common/keyCodes';
import { IDisposable, dispose } from 'vs/base/common/lifecycle';
import { TPromise } from 'vs/base/common/winjs.base';
import 'vs/css!./media/settingsEditor2';
import { localize } from 'vs/nls';
import { ConfigurationTarget, IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IContextKey } from 'vs/platform/contextkey/common/contextkey';
import { IContextMenuService, IContextViewService } from 'vs/platform/contextview/browser/contextView';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { WorkbenchList } from 'vs/platform/list/browser/listService';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { attachInputBoxStyler, attachSelectBoxStyler } from 'vs/platform/theme/common/styler';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { BaseEditor } from 'vs/workbench/browser/parts/editor/baseEditor';
import { EditorOptions } from 'vs/workbench/common/editor';
import { SearchWidget, SettingsTargetsWidget } from 'vs/workbench/parts/preferences/browser/preferencesWidgets';
import { IPreferencesService, ISetting } from 'vs/workbench/services/preferences/common/preferences';
import { PreferencesEditorInput2 } from 'vs/workbench/services/preferences/common/preferencesEditorInput';
import { DefaultSettingsEditorModel } from 'vs/workbench/services/preferences/common/preferencesModels';

const SETTINGS_ENTRY_TEMPLATE_ID = 'settings.entry.template';
const SETTINGS_NAV_TEMPLATE_ID = 'settings.nav.template';

interface IListEntry {
	id: string;
	templateId: string;
}

interface ISettingItemEntry extends IListEntry {
	key: string;
	value: any;
	description: string;
	type?: string | string[];
	enum?: string[];
}

interface INavListEntry extends IListEntry {
	title: string;
	index: number;
}

let $ = DOM.$;

export class SettingsEditor2 extends BaseEditor {

	public static readonly ID: string = 'workbench.editor.settings2';

	private defaultSettingsEditorModel: DefaultSettingsEditorModel;

	private headerContainer: HTMLElement;
	private searchWidget: SearchWidget;
	private settingsTargetsWidget: SettingsTargetsWidget;

	private settingsListContainer: HTMLElement;
	private navListContainer: HTMLElement;
	private listEntries: IListEntry[];
	private settingsList: List<IListEntry>;
	private navList: List<IListEntry>;

	private dimension: DOM.Dimension;
	private delayedFiltering: Delayer<void>;
	private latestEmptyFilters: string[] = [];
	private delayedFilterLogging: Delayer<void>;
	private keybindingsEditorContextKey: IContextKey<boolean>;
	private keybindingFocusContextKey: IContextKey<boolean>;
	private searchFocusContextKey: IContextKey<boolean>;

	constructor(
		@ITelemetryService telemetryService: ITelemetryService,
		@IConfigurationService private configurationService: IConfigurationService,
		@IThemeService themeService: IThemeService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IPreferencesService private preferencesService: IPreferencesService,
		@INotificationService private notificationService: INotificationService,
		@IInstantiationService private instantiationService: IInstantiationService
	) {
		super(SettingsEditor2.ID, telemetryService, themeService);
		this.delayedFiltering = new Delayer<void>(300);
		this._register(configurationService.onDidChangeConfiguration(() => this.render()));
	}

	createEditor(parent: HTMLElement): void {
		const prefsEditorElement = DOM.append(parent, $('div', { class: 'settings-editor' }));

		this.createHeader(prefsEditorElement);
		this.createBody(prefsEditorElement);

		// const focusTracker = this._register(DOM.trackFocus(parent));
		// this._register(focusTracker.onDidFocus(() => this.keybindingsEditorContextKey.set(true)));
		// this._register(focusTracker.onDidBlur(() => this.keybindingsEditorContextKey.reset()));
	}

	setInput(input: PreferencesEditorInput2, options: EditorOptions): TPromise<void> {
		const oldInput = this.input;
		return super.setInput(input)
			.then(() => {
				if (!input.matches(oldInput)) {
					this.render();
				}
			});
	}

	clearInput(): void {
		super.clearInput();
		// this.keybindingsEditorContextKey.reset();
		// this.keybindingFocusContextKey.reset();
	}

	layout(dimension: DOM.Dimension): void {
		this.dimension = dimension;
		this.searchWidget.layout(dimension);

		this.layoutSettingsList();
	}

	focus(): void {
		this.searchWidget.focus();
	}

	getSecondaryActions(): IAction[] {
		return <IAction[]>[
		];
	}

	search(filter: string): void {
		this.searchWidget.focus();
	}

	clearSearchResults(): void {
		this.searchWidget.clear();
	}

	private createHeader(parent: HTMLElement): void {
		this.headerContainer = DOM.append(parent, $('.settings-header'));

		const searchContainer = DOM.append(this.headerContainer, $('.search-container'));
		this.searchWidget = this._register(this.instantiationService.createInstance(SearchWidget, searchContainer, {
			ariaLabel: localize('SearchSettings.AriaLabel', "Search settings"),
			placeholder: localize('SearchSettings.Placeholder', "Search settings"),
			focusKey: this.searchFocusContextKey
		}));
		// this._register(this.searchWidget.onDidChange(searchValue => this.delayedFiltering.trigger(() => this.filterSettings())));

		const headerControlsContainer = DOM.append(this.headerContainer, $('div.settings-header-controls-container'));
		const targetWidgetContainer = DOM.append(headerControlsContainer, $('.settings-target-container'));
		this.settingsTargetsWidget = this._register(this.instantiationService.createInstance(SettingsTargetsWidget, targetWidgetContainer));
		this.settingsTargetsWidget.settingsTarget = ConfigurationTarget.USER;
		this.settingsTargetsWidget.onDidTargetChange(e => this.renderEntries());

		this.createOpenSettingsElement(headerControlsContainer);
	}

	private createOpenSettingsElement(parent: HTMLElement): void {
		const openSettingsContainer = DOM.append(parent, $('.open-settings-container'));
		DOM.append(openSettingsContainer, $('', null, localize('header-message', "For advanced customizations open and edit")));
		const fileElement = DOM.append(openSettingsContainer, $('.file-name', null, localize('settings-file-name', "settings.json")));
		fileElement.tabIndex = 0;

		this._register(DOM.addDisposableListener(fileElement, DOM.EventType.CLICK, () => this.preferencesService.openGlobalSettings()));
		this._register(DOM.addDisposableListener(fileElement, DOM.EventType.KEY_UP, e => {
			let keyboardEvent = new StandardKeyboardEvent(e);
			switch (keyboardEvent.keyCode) {
				case KeyCode.Enter:
					this.preferencesService.openGlobalSettings();
					keyboardEvent.preventDefault();
					keyboardEvent.stopPropagation();
					return;
			}
		}));
	}

	private createBody(parent: HTMLElement): void {
		const bodyContainer = DOM.append(parent, $('.settings-body'));
		this.createNavList(bodyContainer);
		this.createList(bodyContainer);
	}

	private createNavList(parent: HTMLElement): void {
		this.navListContainer = DOM.append(parent, $('.settings-nav-list-container'));

		const listRenderer = this.instantiationService.createInstance(NavItemRenderer);
		this.navList = <WorkbenchList<IListEntry>>this._register(this.instantiationService.createInstance(
			WorkbenchList,
			this.navListContainer,
			new Delegate(),
			[listRenderer],
			{
				identityProvider: e => e.id,
				ariaLabel: localize('navListLabel', "Settings Categories")
			}));
	}

	private createList(parent: HTMLElement): void {
		this.settingsListContainer = DOM.append(parent, $('.settings-list-container'));

		const listRenderer = this.instantiationService.createInstance(SettingItemRenderer);
		listRenderer.onDidChangeSetting(e => this.onDidChangeSetting(e.key, e.value));
		this.settingsList = this._register(this.instantiationService.createInstance(
			WorkbenchList,
			this.settingsListContainer,
			new Delegate(),
			[listRenderer],
			{
				identityProvider: e => e.id,
				ariaLabel: localize('settingsListLabel', "Settings"),
				focusOnMouseDown: false,
				selectOnMouseDown: false,
				keyboardSupport: false,
				mouseSupport: false,
				listFocusOutline: undefined,
				listHoverBackground: undefined // Doesn't do anything
			})
		) as WorkbenchList<IListEntry>;

		this.settingsList.style({ listHoverBackground: Color.transparent, listFocusOutline: Color.transparent });
		DOM.addClass(this.settingsList.getHTMLElement(), 'element-focused');

		// this._register(this.settingsList.onContextMenu(e => this.onContextMenu(e)));
		// this._register(this.settingsList.onFocusChange(e => this.onFocusChange(e)));
		this._register(this.settingsList.onDidFocus(() => {
			DOM.addClass(this.settingsList.getHTMLElement(), 'element-focused');
		}));
		// this._register(this.settingsList.onDidBlur(() => {
		// 	DOM.removeClass(this.settingsList.getHTMLElement(), 'focused');
		// 	// this.keybindingFocusContextKey.reset();
		// }));
	}

	private onDidChangeSetting(key: string, value: any): void {
		this.configurationService.updateValue(key, value, <ConfigurationTarget>this.settingsTargetsWidget.settingsTarget).then(
			null,
			e => {
				this.notificationService.error('Setting update failed: ' + e.message);
			});
	}

	private render(): TPromise<any> {
		if (this.input) {
			return this.input.resolve()
				.then((model: DefaultSettingsEditorModel) => this.defaultSettingsEditorModel = model)
				.then(() => this.renderEntries());
		}
		return TPromise.as(null);
	}

	private filterSettings(): void {
		this.renderEntries();
		this.delayedFilterLogging.trigger(() => this.reportFilteringUsed(this.searchWidget.getValue()));
	}

	private renderEntries(): void {
		if (this.defaultSettingsEditorModel) {

			const entries: ISettingItemEntry[] = [];
			const navEntries: INavListEntry[] = [];
			for (const groupIdx in this.defaultSettingsEditorModel.settingsGroups) {
				const group = this.defaultSettingsEditorModel.settingsGroups[groupIdx];
				navEntries.push({
					id: group.id,
					index: parseInt(groupIdx),
					title: group.title,
					templateId: SETTINGS_NAV_TEMPLATE_ID
				});

				for (const section of group.sections) {
					for (const setting of section.settings) {
						entries.push(this.settingToEntry(setting));
					}
				}
			}

			this.settingsList.splice(0, this.settingsList.length, entries);
			this.navList.splice(0, this.navList.length, navEntries);
		}
	}

	private settingToEntry(s: ISetting): ISettingItemEntry {
		const targetSelector = this.settingsTargetsWidget.settingsTarget === ConfigurationTarget.USER ? 'user' : 'workspace';
		const inspected = this.configurationService.inspect(s.key);
		const displayValue = typeof inspected[targetSelector] === 'undefined' ? inspected.default : inspected[targetSelector];

		return <ISettingItemEntry>{
			id: s.key,
			key: s.key,
			value: displayValue,
			description: s.description.join('\n'),
			enum: s.enum,
			type: s.type,
			templateId: SETTINGS_ENTRY_TEMPLATE_ID
		};
	}

	private layoutSettingsList(): void {
		const listHeight = this.dimension.height - (DOM.getDomNodePagePosition(this.headerContainer).height + 12 /*padding*/);
		this.settingsListContainer.style.height = `${listHeight}px`;
		this.settingsList.layout(listHeight);
		this.navList.layout(listHeight);
	}

	private reportFilteringUsed(filter: string): void {
		if (filter) {
			let data = {
				filter,
				emptyFilters: this.getLatestEmptyFiltersForTelemetry()
			};
			this.latestEmptyFilters = [];
			/* __GDPR__
				"keybindings.filter" : {
					"filter": { "classification": "CustomerContent", "purpose": "FeatureInsight" },
					"emptyFilters" : { "classification": "SystemMetaData", "purpose": "FeatureInsight" }
				}
			*/
			this.telemetryService.publicLog('keybindings.filter', data);
		}
	}

	/**
	 * Put a rough limit on the size of the telemetry data, since otherwise it could be an unbounded large amount
	 * of data. 8192 is the max size of a property value. This is rough since that probably includes ""s, etc.
	 */
	private getLatestEmptyFiltersForTelemetry(): string[] {
		let cumulativeSize = 0;
		return this.latestEmptyFilters.filter(filterText => (cumulativeSize += filterText.length) <= 8192);
	}
}

class Delegate implements IDelegate<IListEntry> {

	getHeight(element: IListEntry) {
		return element.templateId === SETTINGS_NAV_TEMPLATE_ID ? 25 : 110;
	}

	getTemplateId(element: IListEntry) {
		return element.templateId;
	}
}

interface ISettingItemTemplate {
	parent: HTMLElement;
	toDispose: IDisposable[];

	containerElement: HTMLElement;
	labelElement: HTMLElement;
	keyElement: HTMLElement;
	descriptionElement: HTMLElement;
	valueElement: HTMLElement;
}

interface INavItemTemplate {
	parent: HTMLElement;

	labelElement: HTMLElement;
}

interface ISettingChangeEvent {
	key: string;
	value: any;
}

class SettingItemRenderer implements IRenderer<ISettingItemEntry, ISettingItemTemplate> {

	private readonly _onDidChangeSetting: Emitter<ISettingChangeEvent> = new Emitter<ISettingChangeEvent>();
	public readonly onDidChangeSetting: Event<ISettingChangeEvent> = this._onDidChangeSetting.event;

	get templateId(): string { return SETTINGS_ENTRY_TEMPLATE_ID; }

	constructor(
		@IContextViewService private contextViewService: IContextViewService,
		@IThemeService private themeService: IThemeService
	) { }

	renderTemplate(parent: HTMLElement): ISettingItemTemplate {
		DOM.addClass(parent, 'setting-item');

		const keyElement = $('span.setting-item-key');
		const labelElement = $('span.setting-item-label');
		const titleElement = $('div.setting-item-title', undefined, labelElement, keyElement);

		const descriptionElement = $('div.setting-item-description');
		const valueElement = $('div.setting-item-value');

		const itemContainer = $('div.setting-item-container', undefined, titleElement, descriptionElement, valueElement);

		return {
			parent: parent,
			toDispose: [],

			containerElement: itemContainer,
			keyElement,
			labelElement,
			descriptionElement,
			valueElement
		};
	}

	renderElement(entry: ISettingItemEntry, index: number, template: ISettingItemTemplate): void {
		DOM.toggleClass(template.parent, 'odd', index % 2 === 1);

		template.keyElement.textContent = entry.key;
		template.labelElement.textContent = settingKeyToLabel(entry.key);
		template.descriptionElement.textContent = entry.description;

		this.renderValue(entry, template);
	}

	private renderValue(entry: ISettingItemEntry, template: ISettingItemTemplate): void {
		const onChange = value => this._onDidChangeSetting.fire({ key: entry.key, value });
		template.valueElement.innerHTML = '';
		if (entry.type === 'string' && entry.enum) {
			this.renderEnum(entry, template, onChange);
		} else if (entry.type === 'boolean') {
			this.renderBool(entry, template, onChange);
		} else if (entry.type === 'string') {
			this.renderText(entry, template, onChange);
		} else if (entry.type === 'number') {
			this.renderText(entry, template, value => onChange(parseInt(value)));
		} else {
			template.valueElement.textContent = 'Edit in settings.json!';
		}

		template.parent.appendChild(template.containerElement);
	}

	private renderBool(entry: ISettingItemEntry, template: ISettingItemTemplate, onChange: (value: boolean) => void): void {
		const checkbox = new Checkbox({
			isChecked: entry.value,
			title: entry.key,
			onChange: e => onChange(e.valueOf()),
			actionClassName: 'setting-value-checkbox'
		});
		template.toDispose.push(checkbox);

		template.valueElement.appendChild(checkbox.domNode);
	}

	private renderEnum(entry: ISettingItemEntry, template: ISettingItemTemplate, onChange: (value: string) => void): void {
		const idx = entry.enum.indexOf(entry.value);
		const selectBox = new SelectBox(entry.enum, idx, this.contextViewService);
		template.toDispose.push(selectBox);
		template.toDispose.push(attachSelectBoxStyler(selectBox, this.themeService, {
			// selectBackground: editorBackground
		}));
		selectBox.render(template.valueElement);

		template.toDispose.push(
			selectBox.onDidSelect(e => onChange(entry.enum[e.index])));
	}

	private renderText(entry: ISettingItemEntry, template: ISettingItemTemplate, onChange: (value: string) => void): void {
		const inputBox = new InputBox(template.valueElement, this.contextViewService);
		template.toDispose.push(attachInputBoxStyler(inputBox, this.themeService, {
		}));
		template.toDispose.push(inputBox);
		inputBox.value = entry.value;

		template.toDispose.push(
			inputBox.onDidChange(e => onChange(e)));
	}

	disposeTemplate(template: ISettingItemTemplate): void {
		dispose(template.toDispose);
	}
}

class NavItemRenderer implements IRenderer<INavListEntry, INavItemTemplate> {

	get templateId(): string { return SETTINGS_NAV_TEMPLATE_ID; }

	constructor(
	) { }

	renderTemplate(parent: HTMLElement): INavItemTemplate {
		DOM.addClass(parent, 'nav-item');

		const labelElement = DOM.append(parent, $('span.nav-item-label'));
		return {
			parent: parent,
			labelElement
		};
	}

	renderElement(entry: INavListEntry, index: number, template: INavItemTemplate): void {
		DOM.toggleClass(template.parent, 'odd', index % 2 === 1);

		template.labelElement.textContent = entry.title;
	}

	disposeTemplate(template: ISettingItemTemplate): void {
		dispose(template.toDispose);
	}
}

function settingKeyToLabel(key: string): string {
	const lastDotIdx = key.lastIndexOf('.');
	if (lastDotIdx >= 0) {
		key = key.substr(0, lastDotIdx) + ': ' + key.substr(lastDotIdx + 1);
	}

	return key
		.replace(/\.([a-z])/, (match, p1) => `.${p1.toUpperCase()}`)
		.replace(/([a-z])([A-Z])/g, '$1 $2') // fooBar => foo Bar
		.replace(/^[a-z]/g, match => match.toUpperCase()) // foo => Foo
		.replace(/ [a-z]/g, match => match.toUpperCase()); // Foo bar => Foo Bar
}

// registerThemingParticipant((theme: ITheme, collector: ICssStyleCollector) => {
// 	const listHighlightForegroundColor = theme.getColor(listHighlightForeground);
// 	if (listHighlightForegroundColor) {
// 		collector.addRule(`.keybindings-editor > .keybindings-body > .keybindings-list-container .monaco-list-row > .column .highlight { color: ${listHighlightForegroundColor}; }`);
// 	}
// });
