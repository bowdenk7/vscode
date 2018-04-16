/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as DOM from 'vs/base/browser/dom';
import { StandardKeyboardEvent } from 'vs/base/browser/keyboardEvent';
import { IDelegate, IListContextMenuEvent, IListEvent, IRenderer } from 'vs/base/browser/ui/list/list';
import { List } from 'vs/base/browser/ui/list/listWidget';
import { IAction } from 'vs/base/common/actions';
import { Delayer } from 'vs/base/common/async';
import { KeyCode } from 'vs/base/common/keyCodes';
import { TPromise } from 'vs/base/common/winjs.base';
import 'vs/css!./media/settingsEditor2';
import { localize } from 'vs/nls';
import { IContextKey } from 'vs/platform/contextkey/common/contextkey';
import { IContextMenuService, IContextViewService } from 'vs/platform/contextview/browser/contextView';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { WorkbenchList } from 'vs/platform/list/browser/listService';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { BaseEditor } from 'vs/workbench/browser/parts/editor/baseEditor';
import { EditorOptions } from 'vs/workbench/common/editor';
import { SearchWidget, SettingsTargetsWidget } from 'vs/workbench/parts/preferences/browser/preferencesWidgets';
import { KEYBINDINGS_EDITOR_SHOW_DEFAULT_KEYBINDINGS, KEYBINDINGS_EDITOR_SHOW_USER_KEYBINDINGS } from 'vs/workbench/parts/preferences/common/preferences';
import { IWorkbenchEditorService } from 'vs/workbench/services/editor/common/editorService';
import { IKeybindingItemEntry, IListEntry, KEYBINDING_ENTRY_TEMPLATE_ID, KEYBINDING_HEADER_TEMPLATE_ID } from 'vs/workbench/services/preferences/common/keybindingsEditorModel';
import { IPreferencesService, ISetting } from 'vs/workbench/services/preferences/common/preferences';
import { PreferencesEditorInput2 } from 'vs/workbench/services/preferences/common/preferencesEditorInput';
import { IConfigurationService, ConfigurationTarget } from 'vs/platform/configuration/common/configuration';
import { DefaultSettingsEditorModel, SETTINGS_ENTRY_TEMPLATE_ID } from '../../../services/preferences/common/preferencesModels';
import { SelectBox } from 'vs/base/browser/ui/selectBox/selectBox';
import { Disposable, IDisposable, dispose } from 'vs/base/common/lifecycle';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { Checkbox } from 'vs/base/browser/ui/checkbox/checkbox';
import { InputBox } from 'vs/base/browser/ui/inputbox/inputBox';
import { attachSelectBoxStyler, attachInputBoxStyler } from 'vs/platform/theme/common/styler';
import { EDITOR_GROUP_HEADER_NO_TABS_BACKGROUND } from '../../../common/theme';
import { editorBackground } from 'vs/platform/theme/common/colorRegistry';
import { Color } from 'vs/base/common/color';

export interface IListEntry {
	id: string;
	templateId: string;
}

export interface ISettingItemEntry extends IListEntry {
	settingItem: ISetting;
}

export interface ISettingItem {
	name: string;
	description: string;
}

let $ = DOM.$;

export class SettingsEditor2 extends BaseEditor {

	public static readonly ID: string = 'workbench.editor.settings2';

	private defaultSettingsEditorModel: DefaultSettingsEditorModel;

	private headerContainer: HTMLElement;
	private searchWidget: SearchWidget;
	private settingsTargetsWidget: SettingsTargetsWidget;

	private settingsListContainer: HTMLElement;
	private listEntries: IListEntry[];
	private settingsList: List<IListEntry>;

	private dimension: DOM.Dimension;
	private delayedFiltering: Delayer<void>;
	private latestEmptyFilters: string[] = [];
	private delayedFilterLogging: Delayer<void>;
	private keybindingsEditorContextKey: IContextKey<boolean>;
	private keybindingFocusContextKey: IContextKey<boolean>;
	private searchFocusContextKey: IContextKey<boolean>;

	constructor(
		@ITelemetryService telemetryService: ITelemetryService,
		@IConfigurationService configurationService: IConfigurationService,
		@IThemeService themeService: IThemeService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IPreferencesService private preferencesService: IPreferencesService,
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
					this.render(options && options.preserveFocus);
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
			<IAction>{
				label: localize('showDefaultKeybindings', "Show Default Keybindings"),
				enabled: true,
				id: KEYBINDINGS_EDITOR_SHOW_DEFAULT_KEYBINDINGS,
				run: (): TPromise<any> => {
					this.searchWidget.setValue('@source:default');
					return TPromise.as(null);
				}
			},
			<IAction>{
				label: localize('showUserKeybindings', "Show User Keybindings"),
				enabled: true,
				id: KEYBINDINGS_EDITOR_SHOW_USER_KEYBINDINGS,
				run: (): TPromise<any> => {
					this.searchWidget.setValue('@source:user');
					return TPromise.as(null);
				}
			}
		];
	}

	search(filter: string): void {
		this.searchWidget.focus();
	}

	clearSearchResults(): void {
		this.searchWidget.clear();
	}

	showSimilarKeybindings(keybindingEntry: IKeybindingItemEntry): TPromise<any> {
		const value = `"${keybindingEntry.keybindingItem.keybinding.getAriaLabel()}"`;
		if (value !== this.searchWidget.getValue()) {
			this.searchWidget.setValue(value);
		}
		return TPromise.as(null);
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
		this.createOpenSettingsElement(headerControlsContainer);

		const targetWidgetContainer = DOM.append(headerControlsContainer, $('.settings-target-container'));

		this.settingsTargetsWidget = this._register(this.instantiationService.createInstance(SettingsTargetsWidget, targetWidgetContainer));
		this.settingsTargetsWidget.settingsTarget = ConfigurationTarget.USER;
		// this._register(this.settingsTargetsWidget.onDidTargetChange(target => this._onDidSettingsTargetChange.fire(target)));
	}

	private createOpenSettingsElement(parent: HTMLElement): void {
		const openSettingsContainer = DOM.append(parent, $('.open-settings-container'));
		DOM.append(openSettingsContainer, $('', null, localize('header-message', "For advanced customizations open and edit")));
		const fileElement = DOM.append(openSettingsContainer, $('.file-name', null, localize('settings-file-name', "settings.json")));
		fileElement.tabIndex = 0;

		this._register(DOM.addDisposableListener(fileElement, DOM.EventType.CLICK, () => this.preferencesService.openGlobalKeybindingSettings(true)));
		this._register(DOM.addDisposableListener(fileElement, DOM.EventType.KEY_UP, e => {
			let keyboardEvent = new StandardKeyboardEvent(e);
			switch (keyboardEvent.keyCode) {
				case KeyCode.Enter:
					this.preferencesService.openGlobalKeybindingSettings(true);
					keyboardEvent.preventDefault();
					keyboardEvent.stopPropagation();
					return;
			}
		}));
	}

	private createBody(parent: HTMLElement): void {
		const bodyContainer = DOM.append(parent, $('.settings-body'));
		this.createList(bodyContainer);
	}

	private createList(parent: HTMLElement): void {
		this.settingsListContainer = DOM.append(parent, $('.settings-list-container'));

		this.settingsList = this._register(this.instantiationService.createInstance(
			WorkbenchList,
			this.settingsListContainer,
			new Delegate(),
			[this.instantiationService.createInstance(SettingItemRenderer)],
			{
				identityProvider: e => e.id,
				ariaLabel: localize('settingsListLabel', "Settings"),
				focusOnMouseDown: false,
				selectOnMouseDown: false,
				keyboardSupport: false,
				mouseSupport: false,
				listFocusOutline: undefined,
				listHoverBackground: undefined
			})
		) as WorkbenchList<IListEntry>;

		this.settingsList.style({ listHoverBackground: Color.transparent });

		// this._register(this.settingsList.onContextMenu(e => this.onContextMenu(e)));
		// this._register(this.settingsList.onFocusChange(e => this.onFocusChange(e)));
		this._register(this.settingsList.onDidFocus(() => {
			DOM.addClass(this.settingsList.getHTMLElement(), 'focused');
		}));
		this._register(this.settingsList.onDidBlur(() => {
			DOM.removeClass(this.settingsList.getHTMLElement(), 'focused');
			// this.keybindingFocusContextKey.reset();
		}));
	}

	private render(preserveFocus?: boolean): TPromise<any> {
		if (this.input) {
			return this.input.resolve()
				.then((model: DefaultSettingsEditorModel) => this.defaultSettingsEditorModel = model)
				.then(() => this.renderEntries(false, preserveFocus));
		}
		return TPromise.as(null);
	}

	private filterSettings(): void {
		this.renderEntries(this.searchWidget.hasFocus());
		this.delayedFilterLogging.trigger(() => this.reportFilteringUsed(this.searchWidget.getValue()));
	}

	private renderEntries(reset: boolean, preserveFocus?: boolean): void {
		if (this.defaultSettingsEditorModel) {
		const entries: ISettingItemEntry[] = this.defaultSettingsEditorModel.settingsGroups[0].sections[0].settings.map(s => (<ISettingItemEntry>{
				id: '' + Math.random(),
				settingItem: s,
				templateId: SETTINGS_ENTRY_TEMPLATE_ID
			}));

			this.settingsList.splice(0, this.settingsList.length, entries);
		}
	}

	private layoutSettingsList(): void {
		const listHeight = this.dimension.height - (DOM.getDomNodePagePosition(this.headerContainer).height + 12 /*padding*/);
		this.settingsListContainer.style.height = `${listHeight}px`;
		this.settingsList.layout(listHeight);
	}

	private getIndexOf(listEntry: IListEntry): number {
		const index = this.listEntries.indexOf(listEntry);
		if (index === -1) {
			for (let i = 0; i < this.listEntries.length; i++) {
				if (this.listEntries[i].id === listEntry.id) {
					return i;
				}
			}
		}
		return index;
	}

	private onContextMenu(e: IListContextMenuEvent<IListEntry>): void {
		// if (e.element.templateId === KEYBINDING_ENTRY_TEMPLATE_ID) {
		// 	this.contextMenuService.showContextMenu({
		// 		getAnchor: () => e.anchor,
		// 		getActions: () => TPromise.as([
		// 			// this.createCopyAction(<IKeybindingItemEntry>e.element),
		// 			// this.createCopyCommandAction(<IKeybindingItemEntry>e.element),
		// 			// new Separator(),
		// 			// this.createDefineAction(<IKeybindingItemEntry>e.element),
		// 			// this.createRemoveAction(<IKeybindingItemEntry>e.element),
		// 			// this.createResetAction(<IKeybindingItemEntry>e.element),
		// 			// new Separator(),
		// 			// this.createShowConflictsAction(<IKeybindingItemEntry>e.element)
		// 		])
		// 	});
		// }
	}

	private onFocusChange(e: IListEvent<IListEntry>): void {
		this.keybindingFocusContextKey.reset();
		const element = e.elements[0];
		if (!element) {
			return;
		}
		if (element.templateId === KEYBINDING_HEADER_TEMPLATE_ID) {
			this.settingsList.focusNext();
			return;
		}
		if (element.templateId === KEYBINDING_ENTRY_TEMPLATE_ID) {
			this.keybindingFocusContextKey.set(true);
		}
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
		return 110;
	}

	getTemplateId(element: IListEntry) {
		return element.templateId;
	}
}

interface SettingItemTemplate {
	parent: HTMLElement;
	toDispose: IDisposable[];

	containerElement: HTMLElement;
	labelElement: HTMLElement;
	keyElement: HTMLElement;
	descriptionElement: HTMLElement;
	valueElement: HTMLElement;
}

class SettingItemRenderer implements IRenderer<ISettingItemEntry, SettingItemTemplate> {

	get templateId(): string { return SETTINGS_ENTRY_TEMPLATE_ID; }

	constructor(
		@IContextViewService private contextViewService: IContextViewService,
		@INotificationService private notificationService: INotificationService,
		@IConfigurationService private configurationService: IConfigurationService,
		@IThemeService private themeService: IThemeService
	) { }

	renderTemplate(parent: HTMLElement): SettingItemTemplate {
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

	renderElement(settingEntry: ISettingItemEntry, index: number, template: SettingItemTemplate): void {
		DOM.toggleClass(template.parent, 'odd', index % 2 === 1);

		const item = settingEntry.settingItem;

		template.keyElement.textContent = item.key;
		template.labelElement.textContent = settingKeyToLabel(item.key);
		template.descriptionElement.textContent = item.description.join('\n');

		this.renderValue(item, template);
	}

	private renderValue(item: ISetting, template: SettingItemTemplate): void {
		const onChange = value => this.onValueEdit(item.key, value);
		template.valueElement.innerHTML = '';
		if (item.type === 'string' && item.enum) {
			this.renderEnum(item, template, onChange);
		} else if (item.type === 'boolean') {
			this.renderBool(item, template, onChange);
		} else if (item.type === 'string') {
			this.renderText(item, template, onChange);
		} else if (item.type === 'number') {
			this.renderText(item, template, onChange);
		} else {
			template.valueElement.textContent = 'Edit in settings.json!';
		}

		template.parent.appendChild(template.containerElement);
	}

	private onValueEdit(key: string, value: any): void {
		this.configurationService.updateValue(key, value).then(
			null,
			e => {
				this.notificationService.error('Setting update failed: ' + e.message);
			});
	}

	private renderBool(item: ISetting, template: SettingItemTemplate, onChange: (value: boolean) => void): void {
		const checkbox = new Checkbox({
			isChecked: this.configurationService.getValue(item.key),
			title: item.key,
			onChange: e => onChange(e.valueOf()),
			actionClassName: 'setting-value-checkbox'
		});
		template.toDispose.push(checkbox);

		template.valueElement.appendChild(checkbox.domNode);
	}

	private renderEnum(item: ISetting, template: SettingItemTemplate, onChange: (value: string) => void): void {
		const defaultIdx = item.enum.indexOf(this.configurationService.getValue(item.key));
		const selectBox = new SelectBox(item.enum, defaultIdx, this.contextViewService);
		template.toDispose.push(selectBox);
		template.toDispose.push(attachSelectBoxStyler(selectBox, this.themeService, {
			// selectBackground: editorBackground
		}));
		selectBox.render(template.valueElement);

		template.toDispose.push(
			selectBox.onDidSelect(e => onChange(item.enum[e.index])));
	}

	private renderText(item: ISetting, template: SettingItemTemplate, onChange: (value: string|number) => void): void {
		const inputBox = new InputBox(template.valueElement, this.contextViewService);
		template.toDispose.push(attachInputBoxStyler(inputBox, this.themeService, {
		}));
		template.toDispose.push(inputBox);
		inputBox.value = this.configurationService.getValue(item.key);

		template.toDispose.push(
			inputBox.onDidChange(e => onChange(e)));
	}

	disposeTemplate(template: SettingItemTemplate): void {
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
