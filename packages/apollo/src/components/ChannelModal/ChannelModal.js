/*
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
*/

import _ from 'lodash';
import parse from 'parse-duration';
import PropTypes from 'prop-types';
import React, { Component } from 'react';
import { withLocalize } from 'react-localize-redux';
import { connect } from 'react-redux';
import { updateState } from '../../redux/commonActions';
import ChannelApi from '../../rest/ChannelApi';
import IdentityApi from '../../rest/IdentityApi';
import { MspRestApi } from '../../rest/MspRestApi';
import { NodeRestApi } from '../../rest/NodeRestApi';
import { OrdererRestApi } from '../../rest/OrdererRestApi';
import * as constants from '../../utils/constants';
import Helper from '../../utils/helper';
import ACL from '../ChannelModal/Wizard/ACL/ACL';
import Admins from '../ChannelModal/Wizard/Admins/Admins';
import BlockCuttingParams from '../ChannelModal/Wizard/BlockCuttingParams/BlockCuttingParams';
import Capabilities from '../ChannelModal/Wizard/Capabilities/Capabilities';
import Consenters from '../ChannelModal/Wizard/Consenters/Consenters';
import Details from '../ChannelModal/Wizard/Details/Details';
import OrdererSignature from '../ChannelModal/Wizard/OrdererSignature/OrdererSignature';
import Organizations from '../ChannelModal/Wizard/Organizations/Organizations';
import OrgSignature from '../ChannelModal/Wizard/OrgSignature/OrgSignature';
import Policy from '../ChannelModal/Wizard/Policy/Policy';
import Prerequisites from '../ChannelModal/Wizard/Prerequisites/Prerequisites';
import Review from '../ChannelModal/Wizard/Review/Review';
import FocusComponent from '../FocusComponent/FocusComponent';
import Logger from '../Log/Logger';
import SidePanel from '../SidePanel/SidePanel';
import Timeline from '../Timeline/Timeline';
import ChaincodePolicy from './Wizard/ChaincodePolicy/ChaincodePolicy';
import { triggers, triggerSurvey } from '../../utils/medallia';

const acl_resources = require('../../utils/acl/resources.json');
const bytes = require('bytes');
const semver = require('semver');

const SCOPE = 'channelModal';
const Log = new Logger(SCOPE);

class ChannelModal extends Component {
	constructor(props) {
		super(props);
		this.sidePanel = React.createRef();
		this.completedSteps = [];
		if (this.props.channelId) {
			this.buildUpdateChannelTimeline();
		} else {
			this.buildCreateChannelTimeline();
		}
		this.getMsps();
	}

	componentDidMount() {
		// get fresh list of orderers
		OrdererRestApi.getOrderers(true).then(l_orderers => {
			this.props.updateState(SCOPE, {
				orderers: l_orderers,
			});
		});
		let isChannelUpdate = this.props.channelId ? true : false; // channelId is passed only when editing channel
		this.props.updateState(SCOPE, {
			loading: true,
			timelineLoading: true,
			isChannelUpdate,
			submitting: false,
			timelineSteps: this.timelineSteps,
			selectedTimelineStep: {
				currentStepInsideOfGroupIndex: 0,
				currentStepIndex: 0,
			},
			viewing: this.props.channelId ? 'organization_updating_channel' : 'prerequisites',
			channelName: this.props.channelId ? this.props.channelId : '',
			// If channel associated to multiple orderers, let user choose which one to use for submitting channel update
			orderers: _.size(this.props.channelOrderer) > 1 ? this.props.channelOrderer : this.props.orderers,
			selectedOrderer: _.size(this.props.channelOrderer) === 1 ? this.props.channelOrderer[0] : null,
			orgs: [],
			original_orgs: [],
			orderer_orgs: this.props.existingOrdererOrgs,
			msps: [],
			selectedOrg: null,
			memberCounts: [],
			identities: null,
			advanced: this.props.channelId ? true : false,
			raftNodes: [],
			availableChannelCapabilities: [],
			availableOrdererCapabilities: [],
			availableApplicationCapabilities: [],
			selectedChannelCapability: null,
			selectedOrdererCapability: null,
			selectedApplicationCapability: null,
			absolute_max_bytes: null,
			max_message_count: null,
			preferred_max_bytes: null,
			timeout: null,
			absolute_max_bytes_mb: null,
			timeout_ms: null,
			tick_interval: null,
			tick_interval_ms: null,
			election_tick: null,
			heartbeat_tick: null,
			max_inflight_blocks: null,
			snapshot_interval_size: null,
			snapshot_interval_size_mb: null,
			loadingConsenters: false,
			consenters: this.props.existingConsenters ? this.props.existingConsenters : [],
			selectedConsenter: null,
			acls: [],
			aclErrors: [],
			updateOrdererDefError: false,
			overrideDefaults: this.props.channelId ? true : false,
			overrideRaftDefaults: this.props.channelId ? true : false,
			selectedOrdererMsp: null,
			selectedIdentity: null,
			selectedChannelCreator: null,
			availableAdmins: [],
			invalid_consenter: false,
			use_default_consenters: !isChannelUpdate,
			lifecycle_policy: {
				type: 'MAJORITY',
				members: [],
				n: '',
			},
			endorsement_policy: {
				type: 'MAJORITY',
				members: [],
				n: '',
			},
			channel_warning_20: false,
			channel_warning_20_details: [],
			nodeou_warning: false,
		});
		this.getAvailableCapabilities(isChannelUpdate);
		if (!this.props.editLoading) {
			this.populateBlockParams();
			this.populateRaftParams();
		}
	}

	componentDidUpdate(prevProps) {
		if (prevProps.editLoading && !this.props.editLoading) {
			this.populateBlockParams();
			this.populateRaftParams();
		}
	}

	componentWillUnmount() {
		this.props.updateState(SCOPE, {
			loading: false,
			submitting: false,
			identities: null,
			orgs: [],
			original_orgs: [],
			orderer_orgs: [],
			acls: [],
			aclErrors: [],
			availableACLPolicies: [],
			channelName: null,
			isChannelUpdate: false,
			selectedOrg: null,
			channelNameError: '',
			noOperatorError: '',
			duplicateMSPError: '',
			createChannelError: '',
			missingDefinitionError: '',
			isOrdererUnavailable: false,
			isTLSUnavailable: false,
			checkingOrdererStatus: false,
			customPolicy: null,
		});
	}

	populateBlockParams = () => {
		const { existingBlockParams } = this.props;
		this.props.updateState(SCOPE, {
			absolute_max_bytes: existingBlockParams ? existingBlockParams.absolute_max_bytes : bytes(constants.ABSOLUTE_MAX_BYTES_DEFAULT),
			max_message_count: existingBlockParams ? existingBlockParams.max_message_count : constants.MAX_MESSAGE_COUNT_DEFAULT,
			preferred_max_bytes: existingBlockParams ? existingBlockParams.preferred_max_bytes : bytes(constants.PREFERRED_MAX_BYTES_DEFAULT),
			timeout: existingBlockParams ? existingBlockParams.timeout : constants.TIMEOUT_DEFAULT,
		});
	};

	populateRaftParams = () => {
		const { existingRaftParams } = this.props;
		this.props.updateState(SCOPE, {
			snapshot_interval_size: existingRaftParams ? existingRaftParams.snapshot_interval_size : bytes(constants.SNAPSHOT_INTERVAL_SIZE_DEFAULT),
		});
	};

	buildCreateChannelTimeline = () => {
		this.timelineSteps = [
			[
				{
					type: 'intro',
					groupSteps: [
						{
							label: 'prerequisites',
							onClick: () => this.showStep('prerequisites', 0, 0),
							isLink: true,
							disabled: false,
						},
					],
				},
			],
			[
				{
					groupTitle: 'required_step',
					groupSteps: [
						{
							label: 'channel_details',
							onClick: () => this.showStep('channel_details', 1, 0),
							isLink: false,
							disabled: false,
						},
						{
							label: 'channel_organizations',
							onClick: () => this.showStep('channel_organizations', 1, 1),
							isLink: false,
							disabled: false,
						},
						{
							label: 'channel_update_policy',
							onClick: () => this.showStep('channel_update_policy', 1, 2),
							isLink: false,
							disabled: false,
						},
						{
							label: 'organization_creating_channel',
							onClick: () => this.showStep('organization_creating_channel', 1, 3),
							isLink: false,
							disabled: false,
						},
					],
				},
			],
			[
				{
					groupTitle: 'advanced_configuration',
					groupSteps: [
						{
							label: 'capabilities',
							onClick: () => this.showStep('capabilities', 2, 0),
							isLink: false,
							disabled: true,
						},
						{
							label: 'channel_lifecycle_policy',
							onClick: () => this.showStep('lifecycle_policy', 2, 1),
							isLink: false,
							disabled: true,
						},
						{
							label: 'channel_endorsement_policy',
							onClick: () => this.showStep('endorsement_policy', 2, 2),
							isLink: false,
							disabled: true,
						},
						{
							label: 'block_cutting_params',
							onClick: () => this.showStep('block_cutting_params', 2, 3),
							isLink: false,
							disabled: true,
						},
						{
							label: 'consenter_set',
							onClick: () => this.showStep('consenter_set', 2, 4),
							isLink: false,
							disabled: true,
						},
						{
							label: 'ordering_service_organization',
							onClick: () => this.showStep('ordering_service_organization', 2, 5),
							isLink: false,
							disabled: true,
						},
						{
							label: 'channel_acls',
							onClick: () => this.showStep('channel_acls', 2, 6),
							isLink: false,
							disabled: true,
						},
					],
				},
			],
			[
				{
					groupTitle: 'review',
					groupSteps: [
						{
							label: 'review_channel_info',
							onClick: () => this.showStep('review_channel_info', 3, 0),
							isLink: false,
							disabled: false,
						},
					],
				},
			],
		];
	};

	buildUpdateChannelTimeline = () => {
		this.timelineSteps = [
			[
				{
					type: 'intro',
					groupSteps: [
						{
							label: 'organization_updating_channel',
							onClick: () => this.showStep('organization_updating_channel', 0, 0),
							isLink: true,
							disabled: false,
						},
					],
				},
			],
			[
				{
					groupTitle: 'channel_configuration',
					groupSteps: [
						{
							label: 'channel_organizations',
							onClick: () => this.showStep('channel_organizations', 1, 0),
							isLink: false,
							disabled: false,
						},
						{
							label: 'channel_update_policy',
							onClick: () => this.showStep('channel_update_policy', 1, 1),
							isLink: false,
							disabled: false,
						},
					],
				},
			],
			[
				{
					groupTitle: 'advanced_configuration',
					groupSteps: [
						{
							label: 'capabilities',
							onClick: () => this.showStep('capabilities', 2, 0),
							isLink: false,
							disabled: false,
						},
						{
							label: 'channel_lifecycle_policy',
							onClick: () => this.showStep('lifecycle_policy', 2, 1),
							isLink: false,
							disabled: false,
						},
						{
							label: 'channel_endorsement_policy',
							onClick: () => this.showStep('endorsement_policy', 2, 2),
							isLink: false,
							disabled: false,
						},
						{
							label: 'block_cutting_params',
							onClick: () => this.showStep('block_cutting_params', 2, 3),
							isLink: false,
							disabled: false,
						},
						{
							label: 'orderer_admin_set',
							onClick: () => this.showStep('orderer_admin_set', 2, 4),
							isLink: false,
							disabled: false,
						},
						{
							label: 'consenter_set',
							onClick: () => this.showStep('consenter_set', 2, 5),
							isLink: false,
							disabled: false,
						},
						{
							label: 'ordering_service_organization',
							onClick: () => this.showStep('ordering_service_organization', 2, 6),
							isLink: false,
							disabled: true,
						},
						{
							label: 'channel_acls',
							onClick: () => this.showStep('channel_acls', 2, 7),
							isLink: false,
							disabled: false,
						},
					],
				},
			],
			[
				{
					groupTitle: 'review_channel_info',
					groupSteps: [
						{
							label: 'review_channel_info',
							onClick: () => this.showStep('review_channel_info', 3, 0),
							isLink: false,
							disabled: false,
						},
					],
				},
			],
		];
	};

	showStep = (name, group, step) => {
		this.props.updateState(SCOPE, {
			viewing: name,
			selectedTimelineStep: {
				currentStepIndex: group,
				currentStepInsideOfGroupIndex: step,
			},
			setFocus: false,
		});
		this.enableNavigationLinks(name, group, step);
		// set focus to first item on step
		window.setTimeout(() => {
			this.props.updateState(SCOPE, { setFocus: true });
		}, 100);
	};

	enableNavigationLinks = (name, group, step) => {
		const { isChannelUpdate, selectedChannelCreator, selectedIdentity, selectedOrdererMsp } = this.props;
		let isCapabilityModified = this.isAnyCapabilityModified();
		let isBlockParamModified = this.isAnyBlockParamModified();
		let isConsenterSetModified = this.isConsenterSetModified();
		let isAdminsModified = this.isAdminsModified();
		let isRaftParamModified = this.isAnyRaftParamModified();
		let isOrdererSignatureNeeded = isCapabilityModified || isBlockParamModified || isConsenterSetModified || isAdminsModified || isRaftParamModified;
		if (isChannelUpdate) {
			if (
				selectedIdentity &&
				selectedIdentity !== 'select_identity' &&
				selectedIdentity.private_key &&
				selectedChannelCreator &&
				selectedChannelCreator !== 'selectedChannelCreator'
			) {
				if (!isOrdererSignatureNeeded || (selectedOrdererMsp && selectedOrdererMsp !== 'selectedChannelCreator')) {
					this.updateTimelineSteps(true, true);
				} else {
					this.updateTimelineSteps(true, false, group, step);
				}
			} else {
				this.updateTimelineSteps(false, true);
			}
		} else {
			this.updateTimelineSteps(true, false, group, step);
		}
	};

	updateTimelineSteps = (enable, all, currentGroup, currentStep) => {
		let updatedSteps = [];
		this.props.timelineSteps.forEach((group, index) => {
			group.forEach(subGroup => {
				if (all) {
					subGroup.groupSteps.forEach(step => {
						step.isLink = enable;
					});
				} else {
					subGroup.groupSteps.forEach((step, stepIndex) => {
						if (index < currentGroup || (index === currentGroup && stepIndex <= currentStep)) {
							step.isLink = enable;
						} else if (this.completedSteps.includes(step.label)) {
							step.isLink = enable;
						} else {
							step.isLink = false;
						}
					});
				}
			});
			updatedSteps.push(group);
		});
		this.props.updateState(SCOPE, {
			timelineSteps: updatedSteps,
		});
	};

	isStepCompleted(step) {
		let complete = true;
		let {
			channelName,
			isChannelUpdate,
			selectedOrderer,
			channelNameError,
			isOrdererUnavailable,
			checkingOrdererStatus,
			noOperatorError,
			duplicateMSPError,
			missingDefinitionError,
			orgs,
			orderer_orgs,
			customPolicy,
			selectedIdentity,
			selectedChannelCreator,
			channel_warning_20,
			nodeou_warning,
			selectedOrdererMsp,
			aclErrors,
			invalid_consenter,
			consenters,
			use_default_consenters,
			selectedOrdererCapability,
			selectedChannelCapability,
			selectedApplicationCapability,
			lifecycle_policy,
			endorsement_policy,
		} = this.props;
		let updatedConsenterCount = this.consenterUpdateCount();
		if (step === 'channel_details') {
			complete = channelName && !channelNameError && !isOrdererUnavailable && !checkingOrdererStatus && selectedOrderer && selectedOrderer !== 'select_orderer';
		}
		if (step === 'channel_organizations') {
			complete = !noOperatorError && !duplicateMSPError && !missingDefinitionError && orgs && !orgs.find(org => org.msp === '');
		}
		if (step === 'channel_update_policy') {
			complete = customPolicy && customPolicy !== 'select_policy';
		}
		if (step === 'organization_creating_channel' || step === 'organization_updating_channel') {
			complete =
				selectedIdentity &&
				selectedIdentity !== 'select_identity' &&
				selectedIdentity.private_key &&
				selectedChannelCreator &&
				selectedChannelCreator !== 'selectedChannelCreator';
		}
		if (step === 'capabilities') {
			complete = channel_warning_20 || nodeou_warning ? false : true;
		}
		if (step === 'block_cutting_params') {
			complete = true;
		}
		if (step === 'orderer_admin_set') {
			complete = isChannelUpdate ? orderer_orgs && orderer_orgs.length > 0 : true;
		}
		if (step === 'consenter_set') {
			complete = isChannelUpdate ? updatedConsenterCount < 2 && _.size(consenters) > 0 : use_default_consenters || _.size(consenters) > 0;
			if (invalid_consenter) {
				complete = false;
			}
		}
		if (step === 'ordering_service_organization') {
			let isCapabilityModified = this.isAnyCapabilityModified();
			let isBlockParamModified = this.isAnyBlockParamModified();
			let isConsenterSetModified = this.isConsenterSetModified();
			let isRaftParamModified = this.isAnyRaftParamModified();
			let isAdminsModified = this.isAdminsModified();
			let isOrdererSignatureNeeded = isCapabilityModified || isBlockParamModified || isConsenterSetModified || isAdminsModified || isRaftParamModified;
			complete = isOrdererSignatureNeeded ? selectedOrdererMsp && selectedOrdererMsp !== 'selectedChannelCreator' : true;
		}
		if (step === 'channel_acls') {
			complete = _.size(aclErrors) === 0;
		}
		if (step === 'lifecycle_policy') {
			complete = lifecycle_policy.type !== 'SPECIFIC' || (_.size(lifecycle_policy.members) > 0 && lifecycle_policy.n > 0);
		}
		if (step === 'endorsement_policy') {
			complete = endorsement_policy.type !== 'SPECIFIC' || (_.size(endorsement_policy.members) > 0 && endorsement_policy.n > 0);
		}
		if (step === 'review_channel_info') {
			let isCapabilityModified = this.isAnyCapabilityModified();
			let isBlockParamModified = this.isAnyBlockParamModified();
			let isConsenterSetModified = this.isConsenterSetModified();
			let isRaftParamModified = this.isAnyRaftParamModified();
			let isAdminsModified = this.isAdminsModified();
			let isOrdererSignatureNeeded = isCapabilityModified || isBlockParamModified || isConsenterSetModified || isAdminsModified || isRaftParamModified;
			complete =
				channelName &&
				!channelNameError &&
				!isOrdererUnavailable &&
				!checkingOrdererStatus &&
				selectedOrderer &&
				selectedOrderer !== 'select_orderer' &&
				!noOperatorError &&
				!duplicateMSPError &&
				!missingDefinitionError &&
				orgs &&
				!orgs.find(org => org.msp === '') &&
				customPolicy &&
				customPolicy !== 'select_policy' &&
				selectedIdentity &&
				selectedIdentity !== 'select_identity' &&
				selectedIdentity.private_key &&
				selectedChannelCreator &&
				selectedChannelCreator !== 'selectedChannelCreator' &&
				(!isChannelUpdate || updatedConsenterCount < 2) &&
				(!isOrdererSignatureNeeded || (selectedOrdererMsp && selectedOrdererMsp !== 'selectedChannelCreator')) &&
				_.size(aclErrors) === 0 &&
				(!isChannelUpdate ||
					(selectedOrdererCapability &&
						selectedOrdererCapability !== 'use_default' &&
						selectedChannelCapability &&
						selectedChannelCapability !== 'use_default' &&
						selectedApplicationCapability &&
						selectedApplicationCapability !== 'use_default'));
		}
		if (complete && !this.completedSteps.includes(step)) {
			this.completedSteps.push(step);
		} else if (!complete && this.completedSteps.includes(step)) {
			let copy = JSON.parse(JSON.stringify(this.completedSteps));
			let filteredSteps = copy.filter(x => x !== step);
			this.completedSteps = filteredSteps;
		}
		return complete;
	}

	getButtons(translate) {
		const { viewing, advanced, submitting, isChannelUpdate } = this.props;
		const isHigherCapabilityAvailable = this.isAnyHigherCapabilityAvailable();
		const isChannel2_0 = this.isChannel2_0();
		const canModifyConsenters = this.canModifyConsenters();
		let isOrdererSignatureNeeded =
			this.isAnyCapabilityModified() ||
			this.isAnyBlockParamModified() ||
			this.isConsenterSetModified() ||
			this.isAdminsModified() ||
			this.isAnyRaftParamModified();
		let buttons = [];
		let back, next;
		let isComplete;
		const group_prerequisites = 0;
		const group_required = 1;
		const group_advanced = 2;
		const group_review = 3;
		const step_prerequisite = 0;
		const step_details = 0;
		let index = isChannelUpdate ? 0 : 1;
		const step_organizations = index++;
		const step_policy = index++;
		const step_org_signature = 3;
		const step_capabilities = 0;
		index = isHigherCapabilityAvailable ? 1 : 0;
		const step_lifecycle_policy = index++;
		const step_endorsement_policy = index++;
		const step_block_parameters = index++;
		const step_orderer_admin_set = index++;
		if (!canModifyConsenters || !isChannelUpdate) {
			index--;
		}
		const step_consenters = index++;
		if (!canModifyConsenters) {
			index--;
		}
		const step_orderer_signature = index++;
		const step_acl = index++;
		const step_review = 0;
		switch (viewing) {
			case 'prerequisites':
				isComplete = true;
				next = () => this.showStep('channel_details', group_required, step_details);
				break;
			case 'channel_details':
				isComplete = this.isStepCompleted('channel_details');
				back = () => this.showStep('prerequisites', group_prerequisites, step_prerequisite);
				next = () => {
					if (isComplete) {
						this.showStep('channel_organizations', group_required, step_organizations);
					}
				};
				break;
			case 'channel_organizations':
				isComplete = this.isStepCompleted('channel_organizations');
				back = () => {
					if (isChannelUpdate) {
						this.showStep('organization_updating_channel', group_prerequisites, step_prerequisite);
					} else {
						this.showStep('channel_details', group_required, step_details);
					}
				};
				next = () => {
					if (isComplete) {
						this.showStep('channel_update_policy', group_required, step_policy);
					}
				};
				break;
			case 'channel_update_policy':
				isComplete = this.isStepCompleted('channel_update_policy');
				back = () => this.showStep('channel_organizations', group_required, step_organizations);
				next = () => {
					if (isComplete) {
						if (isChannelUpdate) {
							this.showStep('capabilities', group_advanced, step_capabilities);
						} else {
							this.showStep('organization_creating_channel', group_required, step_org_signature);
						}
					}
				};
				break;
			case 'organization_creating_channel':
				isComplete = this.isStepCompleted('organization_creating_channel');
				back = () => this.showStep('channel_update_policy', group_required, step_policy);
				if (isChannelUpdate) {
					back = null;
					next = () => {
						if (isComplete) {
							this.showStep('channel_organizations', group_required, step_organizations);
						}
					};
				} else if (advanced) {
					if (isHigherCapabilityAvailable) {
						next = () => {
							if (isComplete) {
								this.showStep('capabilities', group_advanced, step_capabilities);
							}
						};
					} else {
						next = () => {
							if (isComplete) {
								this.showStep('block_cutting_params', group_advanced, step_block_parameters);
							}
						};
					}
				} else {
					next = () => {
						if (isComplete) {
							this.showStep('review_channel_info', group_review, step_review);
						}
					};
				}
				break;
			case 'organization_updating_channel':
				isComplete = this.isStepCompleted('organization_updating_channel');
				back = () => this.showStep('channel_update_policy', group_required, step_policy);
				if (isChannelUpdate) {
					back = null;
					next = () => {
						if (isComplete) {
							this.showStep('channel_organizations', group_required, step_organizations);
						}
					};
				} else if (advanced) {
					if (isHigherCapabilityAvailable) {
						next = () => {
							if (isComplete) {
								this.showStep('capabilities', group_advanced, step_capabilities);
							}
						};
					} else {
						next = () => {
							if (isComplete) {
								this.showStep('block_cutting_params', group_advanced, step_block_parameters);
							}
						};
					}
				} else {
					next = () => {
						if (isComplete) {
							this.showStep('review_channel_info', group_review, step_review);
						}
					};
				}
				break;
			case 'capabilities':
				isComplete = this.isStepCompleted('capabilities');
				back = () => {
					if (isChannelUpdate) {
						this.showStep('channel_update_policy', group_required, step_policy);
					} else {
						this.showStep('organization_creating_channel', group_required, step_org_signature);
					}
				};
				next = () => {
					if (isComplete) {
						if (isChannel2_0) {
							this.showStep('lifecycle_policy', group_advanced, step_lifecycle_policy);
						} else {
							this.showStep('block_cutting_params', group_advanced, step_block_parameters);
						}
					}
				};
				break;
			case 'lifecycle_policy':
				isComplete = this.isStepCompleted('lifecycle_policy');
				back = () => {
					isHigherCapabilityAvailable
						? this.showStep('capabilities', group_advanced, step_capabilities)
						: isChannelUpdate
							? this.showStep('channel_update_policy', group_required, step_policy)
							: this.showStep('organization_creating_channel', group_prerequisites, step_org_signature);
				};
				next = () => {
					if (isComplete) {
						this.showStep('endorsement_policy', group_advanced, step_endorsement_policy);
					}
				};
				break;
			case 'endorsement_policy':
				isComplete = this.isStepCompleted('endorsement_policy');
				back = () => this.showStep('lifecycle_policy', group_advanced, step_lifecycle_policy);
				next = () => {
					if (isComplete) {
						this.showStep('block_cutting_params', group_advanced, step_block_parameters);
					}
				};
				break;
			case 'block_cutting_params':
				isComplete = this.isStepCompleted('block_cutting_params');
				back = () =>
					isChannel2_0
						? this.showStep('endorsement_policy', group_advanced, step_endorsement_policy)
						: isHigherCapabilityAvailable
							? this.showStep('capabilities', group_advanced, step_capabilities)
							: isChannelUpdate
								? this.showStep('channel_update_policy', group_required, step_policy)
								: this.showStep('organization_creating_channel', group_prerequisites, step_org_signature);
				next = () => {
					if (canModifyConsenters) {
						isChannelUpdate
							? this.showStep('orderer_admin_set', group_advanced, step_orderer_admin_set)
							: this.showStep('consenter_set', group_advanced, step_consenters);
					} else {
						isOrdererSignatureNeeded
							? this.showStep('ordering_service_organization', group_advanced, step_orderer_signature)
							: this.showStep('channel_acls', group_advanced, step_acl);
					}
				};
				break;
			case 'orderer_admin_set':
				isComplete = this.isStepCompleted('orderer_admin_set');
				back = () => this.showStep('block_cutting_params', group_advanced, step_block_parameters);
				next = () => this.showStep('consenter_set', group_advanced, step_consenters);
				break;
			case 'consenter_set':
				isComplete = this.isStepCompleted('consenter_set');
				back = () =>
					isChannelUpdate
						? this.showStep('orderer_admin_set', group_advanced, step_orderer_admin_set)
						: this.showStep('block_cutting_params', group_advanced, step_block_parameters);
				next = () => {
					if (isComplete) {
						isOrdererSignatureNeeded
							? this.showStep('ordering_service_organization', group_advanced, step_orderer_signature)
							: this.showStep('channel_acls', group_advanced, step_acl);
					}
				};
				break;
			case 'ordering_service_organization':
				isComplete = this.isStepCompleted('ordering_service_organization');
				back = () => {
					if (canModifyConsenters) {
						this.showStep('consenter_set', group_advanced, step_consenters);
					} else {
						this.showStep('block_cutting_params', group_advanced, step_block_parameters);
					}
				};
				next = () => {
					if (isComplete) {
						this.showStep('channel_acls', group_advanced, step_acl);
					}
				};
				break;
			case 'channel_acls':
				isComplete = this.isStepCompleted('channel_acls');
				back = () =>
					isOrdererSignatureNeeded
						? this.showStep('ordering_service_organization', group_advanced, step_orderer_signature)
						: !canModifyConsenters
							? this.showStep('block_cutting_params', group_advanced, step_block_parameters)
							: this.showStep('consenter_set', group_advanced, step_consenters);
				next = () => {
					if (isComplete) {
						this.showStep('review_channel_info', group_review, step_review);
					}
				};
				break;
			case 'review_channel_info':
				isComplete = this.isStepCompleted('review_channel_info');
				back = advanced
					? () => this.showStep('channel_acls', group_advanced, step_acl)
					: isChannelUpdate
						? () => this.showStep('channel_update_policy', group_required, step_policy)
						: () => this.showStep('organization_creating_channel', group_prerequisites, step_org_signature);
				next = () => {
					if (isComplete) {
						this.onSubmit();
					}
				};
				break;
			default:
				back = () => this.showStep('prerequisites', group_prerequisites, step_prerequisite);
				next = () => this.showStep('prerequisites', group_prerequisites, step_prerequisite);
				break;
		}
		buttons.push(
			{
				text: translate('back'),
				onClick: back,
			},
			{
				text: viewing === 'review_channel_info' ? (this.props.isChannelUpdate ? translate('update_channel') : translate('create_channel')) : translate('next'),
				onClick: viewing === 'review_channel_info' ? (this.props.isChannelUpdate ? this.updateChannel : this.createChannel) : next,
				disabled: !isComplete || submitting,
				type: viewing === 'review_channel_info' ? 'submit' : '',
			}
		);
		return buttons;
	}

	updateTimeSteps = (noHigherCapabilities, isChannelUpdate) => {
		let removeSteps = [];
		if (!this.canModifyConsenters()) {
			removeSteps.push('consenter_set');
		}
		if (!this.canModifyConsenters() || !isChannelUpdate) {
			removeSteps.push('orderer_admin_set');
		}
		if (!this.props.capabilitiesEnabled || noHigherCapabilities) {
			removeSteps.push('capabilities');
		}
		if (removeSteps.length > 0) {
			this.removeStepsFromTimeline(removeSteps);
		} else {
			this.props.updateState(SCOPE, {
				timelineLoading: false,
			});
		}
	};

	removeStepsFromTimeline = removeSteps => {
		let updatedSteps = [];
		this.timelineSteps.forEach(group => {
			group.forEach(subGroup => {
				if (subGroup.groupTitle === 'advanced_configuration') {
					let steps = [];
					subGroup.groupSteps.forEach(step => {
						if (!removeSteps.includes(step.label)) {
							steps.push(step);
						}
					});
					subGroup.groupSteps = steps;
				}
			});
			updatedSteps.push(group);
		});
		this.props.updateState(SCOPE, {
			timelineSteps: updatedSteps,
			timelineLoading: false,
		});
	};

	getMsps = () => {
		let msps = [];
		this.props.updateState(SCOPE, { loading: true });
		MspRestApi.getAllMsps()
			.then(all_msps => {
				all_msps.forEach(msp => {
					msps.push({ ...msp, display_name: msp.display_name + ' (' + msp.msp_id + ')' });
				});
				this.props.updateState(SCOPE, {
					availableAdmins: msps,
					msps: msps,
				});
				this.getAvailableIdentities();
			})
			.catch(error => {
				Log.error(error);
				this.props.updateState(SCOPE, { loading: false });
			});
	};

	getAvailableIdentities = () => {
		IdentityApi.getIdentities()
			.then(identities => {
				this.props.updateState(SCOPE, {
					identities,
				});
				if (this.props.isChannelUpdate) {
					this.populateChannelOrgs();
					this.populateChaincodePolicy();
				} else {
					this.populateACLDropdowns();
					this.props.updateState(SCOPE, { loading: false });
				}
			})
			.catch(error => {
				Log.error(error);
				this.props.updateState(SCOPE, { loading: false });
			});
	};

	populateChannelOrgs = () => {
		let existingOrgs = [];
		let missingDefinitions = [];
		this.props.existingOrgs.forEach(member => {
			let msp_definition = this.props.msps.find(msp => msp.msp_id === member.id);
			let org = {
				msp: member.id,
				roles: member.roles,
				admins: member.admins,
				root_certs: member.root_certs,
				host_url: msp_definition ? msp_definition.host_url : null,
				node_ou: msp_definition ? msp_definition.fabric_node_ous && msp_definition.fabric_node_ous.enable : false,
			};
			existingOrgs.push(org);
			if (!msp_definition) {
				missingDefinitions.push(member.id);
			} else {
				member.host_url = msp_definition.host_url;
			}
		});
		let all_orgs = this.props.orgs ? [...this.props.orgs, ...existingOrgs] : [...existingOrgs];
		this.props.updateState(SCOPE, {
			orgs: all_orgs,
			original_orgs: JSON.parse(JSON.stringify(all_orgs)),
			missingDefinitionError:
				missingDefinitions.length > 0 ? this.props.translate('missing_msp_definition', { list_of_msps: _.join(missingDefinitions, ',') }) : null,
		});
		this.populateChannelAcls();
		this.populateACLDropdowns(existingOrgs.map(x => x.msp));
		this.updatePolicyDropdown(all_orgs, true);
	};

	populateChaincodePolicy = () => {
		const { existingEndorsementPolicy, existingLifecyclePolicy } = this.props;
		this.props.updateState(SCOPE, {
			lifecycle_policy: {
				type: existingLifecyclePolicy.type,
				members: existingLifecyclePolicy.members,
				n: existingLifecyclePolicy.n.toString(),
			},
			endorsement_policy: {
				type: existingEndorsementPolicy.type,
				members: existingEndorsementPolicy.members,
				n: existingEndorsementPolicy.n.toString(),
			},
		});
	};

	updatePolicyDropdown = (orgs, duringInit) => {
		let specificPolicyDropdown = [];
		let admins = orgs && orgs.length ? orgs.filter(org => org.roles.includes('admin')) : [];
		if (admins.length > 0) {
			for (let i = 1; i <= admins.length; i++) {
				specificPolicyDropdown.push({
					name: this.props.translate('channel_specific_policy', {
						count: i,
						total: admins.length,
					}),
					id: i,
				});
			}
		}
		let init_policy = this.props.nOutOf
			? {
				name: this.props.translate('channel_specific_policy', {
					count: this.props.nOutOf.n,
					total: this.props.nOutOf.outOf,
				}),
				id: this.props.nOutOf.n,
			  }
			: {};
		this.props.updateState(SCOPE, {
			memberCounts: specificPolicyDropdown,
			customPolicyDefault: duringInit ? init_policy : specificPolicyDropdown.length === 1 ? specificPolicyDropdown[0] : 'select_policy',
			customPolicy: duringInit ? init_policy : specificPolicyDropdown.length === 1 ? specificPolicyDropdown[0] : null,
		});
	};

	populateChannelAcls = () => {
		let existingAcls = [];
		this.props.existingAcls.forEach(acl => {
			existingAcls.push({
				resource: acl.id,
				definition: acl.policy_ref,
			});
		});
		this.props.updateState(SCOPE, {
			acls: existingAcls,
		});
		if (this.props.selectedOrderer) {
			this.getOrderingServiceDetails(this.props.selectedOrderer);
		}
	};

	populateACLDropdowns = existingOrgs => {
		this.props.updateState(SCOPE, {
			availableACLResources: acl_resources.keys,
			availableACLRoles: ['Admins', 'Readers', 'Writers'],
			availableACLPolicies: existingOrgs ? ['Application', ...existingOrgs] : ['Application'],
		});
	};

	setLifecyclePolicyMembers = data => {
		const { type: currentType, members: currentMembers, n: currentN } = this.props.lifecycle_policy;
		const updatedMembers = data.policyMembers || currentMembers;
		let updatedN = data.policyN || currentN;
		if (data.policyMembers && currentN > data.policyMembers.length) {
			updatedN = data.policyMembers.length.toString();
		} else if (data.policyMembers && data.policyMembers.length && !updatedN) {
			updatedN = '1';
		}
		this.props.updateState(SCOPE, {
			lifecycle_policy: {
				type: currentType,
				members: updatedMembers,
				n: updatedN,
			},
		});
	};

	setEndorsementPolicyMembers = data => {
		const { type: currentType, members: currentMembers, n: currentN } = this.props.endorsement_policy;
		const updatedMembers = data.policyMembers || currentMembers;
		let updatedN = data.policyN || currentN;
		if (data.policyMembers && currentN > data.policyMembers.length) {
			updatedN = data.policyMembers.length.toString();
		} else if (data.policyMembers && data.policyMembers.length && !updatedN) {
			updatedN = '1';
		}
		this.props.updateState(SCOPE, {
			endorsement_policy: {
				type: currentType,
				members: updatedMembers,
				n: updatedN,
			},
		});
	};

	setLifecyclePolicyType = type => {
		const { members, n } = this.props.lifecycle_policy;
		this.props.updateState(SCOPE, {
			lifecycle_policy: {
				type,
				members: type === 'SPECIFIC' ? [] : members,
				n: type === 'SPECIFIC' ? '' : n,
			},
		});
	};

	setEndorsementPolicyType = type => {
		const { members, n } = this.props.endorsement_policy;
		this.props.updateState(SCOPE, {
			endorsement_policy: {
				type,
				members: type === 'SPECIFIC' ? [] : members,
				n: type === 'SPECIFIC' ? '' : n,
			},
		});
	};

	getOrderingServiceDetails = data => {
		const selectedOrderer = data ? data : this.props.selectedOrderer;
		if (!_.has(selectedOrderer, 'id')) return;
		OrdererRestApi.getOrdererDetails(selectedOrderer.id, true).then(orderer => {
			let getCertsFromDeployer = false;
			if (orderer && orderer.raft) {
				this.props.updateState(SCOPE, { loadingConsenters: true });
				const consenters = orderer.raft.map(node => {
					let address = node.backend_addr.split(':');
					if (!node.client_tls_cert && node.location === 'ibm_saas') {
						getCertsFromDeployer = true; // signed certs are missing, get them from deployer first
					} else if (!node.client_tls_cert && node.location !== 'ibm_saas') {
						this.props.updateState(SCOPE, { updateOrdererDefError: true }); // imported orderer definition old, disable consenter set feature
					}
					return {
						name: node.display_name,
						host: address[0],
						port: address[1],
						client_tls_cert: node.client_tls_cert,
						server_tls_cert: node.client_tls_cert,
						msp_id: node.msp_id,
					};
				});

				if (getCertsFromDeployer) {
					NodeRestApi.getTLSSignedCertFromDeployer(orderer.raft)
						.then(nodesWithCerts => {
							Log.debug('Signed certs for raft nodes from deployer', nodesWithCerts);
							nodesWithCerts.forEach(nodeFromFromDeployer => {
								let consenter = consenters.find(x => x.name === nodeFromFromDeployer.display_name);
								if (consenter && nodeFromFromDeployer.client_tls_cert) {
									consenter.client_tls_cert = nodeFromFromDeployer.client_tls_cert;
									consenter.server_tls_cert = nodeFromFromDeployer.server_tls_cert;
								}
								if (consenter && !nodeFromFromDeployer.server_tls_cert) {
									// remove nodes without TLS certs - we cant add them to consenter set
									_.remove(consenters, c => {
										const addr = `${c.host}:${c.port}`;
										return addr === nodeFromFromDeployer.backend_addr;
									});
									this.props.updateState(SCOPE, { isTLSUnavailable: true });
								}
							});
							this.props.updateState(SCOPE, { raftNodes: consenters, loadingConsenters: false, loading: false });
						})
						.catch(error => {
							Log.info('An error occurred when getting signed certs from deployer', error);
							this.props.updateState(SCOPE, { raftNodes: [], isTLSUnavailable: true, loadingConsenters: false, loading: false });
						});
				} else {
					this.props.updateState(SCOPE, { raftNodes: consenters, loadingConsenters: false, loading: false });
				}
			}
		});
	};

	checkHealth = orderer => {
		this.props.updateState(SCOPE, { isOrdererUnavailable: false, checkingOrdererStatus: true });
		OrdererRestApi.checkHealth(orderer)
			.then(resp => {
				Log.info('Orderer health:', resp);
				this.props.updateState(SCOPE, { isOrdererUnavailable: false, checkingOrdererStatus: false });
			})
			.catch(error => {
				Log.error('Orderer status unavailable:', error);
				this.props.updateState(SCOPE, { isOrdererUnavailable: true, checkingOrdererStatus: false });
			});
	};

	getAvailableCapabilities = isChannelUpdate => {
		let noHigherCapabilities;
		if (this.props.capabilitiesEnabled) {
			let availableChannelCapabilities = this.props.capabilities ? Helper.getFormattedCapabilities(this.props.capabilities.channel) : [];
			let availableOrdererCapabilities = this.props.capabilities ? Helper.getFormattedCapabilities(this.props.capabilities.orderer) : [];
			let availableApplicationCapabilities = this.props.capabilities ? Helper.getFormattedCapabilities(this.props.capabilities.application) : [];
			if (this.props.channelId && this.props.existingCapabilities) {
				// When editing, allow capabilities that are higher than current capability
				let currentChannelCapability = semver.coerce(this.props.existingCapabilities.channel.replace(/_/g, '.')).version;
				let currentOrdererCapability = semver.coerce(this.props.existingCapabilities.orderer.replace(/_/g, '.')).version;
				let currentApplicationCapability = this.props.existingCapabilities.application
					? semver.coerce(this.props.existingCapabilities.application.replace(/_/g, '.')).version
					: null;

				availableChannelCapabilities = currentChannelCapability
					? availableChannelCapabilities.filter(x => semver.gte(x.value, currentChannelCapability))
					: availableChannelCapabilities;
				availableOrdererCapabilities = currentOrdererCapability
					? availableOrdererCapabilities.filter(x => semver.gte(x.value, currentOrdererCapability))
					: availableOrdererCapabilities;
				availableApplicationCapabilities = currentApplicationCapability
					? availableApplicationCapabilities.filter(x => semver.gte(x.value, currentApplicationCapability))
					: availableApplicationCapabilities;
				this.props.updateState(SCOPE, {
					selectedApplicationCapability: currentApplicationCapability,
					selectedOrdererCapability: currentOrdererCapability,
					selectedChannelCapability: currentChannelCapability,
				});
			}
			this.props.updateState(SCOPE, { availableChannelCapabilities, availableOrdererCapabilities, availableApplicationCapabilities });
			noHigherCapabilities = _.isEmpty(availableChannelCapabilities) && _.isEmpty(availableOrdererCapabilities) && _.isEmpty(availableApplicationCapabilities);
		}
		this.updateTimeSteps(noHigherCapabilities, isChannelUpdate);
	};

	isAnyHigherCapabilityAvailable = () => {
		const { capabilitiesEnabled, availableChannelCapabilities, availableOrdererCapabilities, availableApplicationCapabilities } = this.props;
		return (
			capabilitiesEnabled &&
			(!_.isEmpty(availableChannelCapabilities) || !_.isEmpty(availableOrdererCapabilities) || !_.isEmpty(availableApplicationCapabilities))
		);
	};

	isChannel2_0 = () => {
		if (this.props.isChannelUpdate) {
			let capability = this.props.existingCapabilities.application || null;
			return capability && capability.indexOf('V2.0') !== -1;
		} else {
			const { selectedApplicationCapability } = this.props;
			const capability =
				selectedApplicationCapability && typeof selectedApplicationCapability === 'object' ? selectedApplicationCapability.id : selectedApplicationCapability;
			return capability && capability.indexOf('V2_0') !== -1;
		}
	};

	canModifyConsenters = () => {
		const { existingCapabilities, scaleRaftNodesEnabled, isChannelUpdate } = this.props;
		const ordererCapability =
			existingCapabilities && existingCapabilities.orderer ? semver.coerce(existingCapabilities.orderer.replace(/_/g, '.')).version : '0.0.0';
		if (!isChannelUpdate) return scaleRaftNodesEnabled;
		else return scaleRaftNodesEnabled && semver.gte(ordererCapability, '1.4.2');
	};

	isConsenterSetModified = () => {
		if (this.props.use_default_consenters) {
			return false;
		}
		let count = this.consenterUpdateCount();
		return count > 0;
	};

	// Number of updates(add/remove) to consenter set
	consenterUpdateCount = () => {
		const { consenters, existingConsenters } = this.props;
		const selectedConsentersHosts = _.isEmpty(consenters) ? [] : consenters.map(x => x.host + ':' + x.port);
		const existingConsentersHosts = _.isEmpty(existingConsenters) ? [] : existingConsenters.map(x => x.host + ':' + x.port);
		const diff = _.xor(selectedConsentersHosts, existingConsentersHosts);
		return diff.length;
	};

	isAdminsModified() {
		let modified = false;
		if (this.props.existingOrdererOrgs && this.props.orderer_orgs) {
			if (this.props.existingOrdererOrgs.length === this.props.orderer_orgs.length) {
				this.props.existingOrdererOrgs.forEach(admin => {
					let found = false;
					this.props.orderer_orgs.forEach(org => {
						if (org.id === admin.id) {
							found = true;
						}
					});
					if (!found) {
						modified = true;
					}
				});
			} else {
				modified = true;
			}
		}
		return modified;
	}

	validateTimeout = value => {
		let isValid = true;
		if (value) {
			const timeout = parse(value);
			isValid = timeout >= parse(constants.TIMEOUT_MIN) && timeout <= parse(constants.TIMEOUT_MAX);
		}
		return isValid;
	};

	verifyACLPolicyValidity = (orgs, acls) => {
		if (this.props.acls) {
			let errors = [];
			let currentOrgs = orgs ? orgs : this.props.orgs.map(org => org.msp);
			let currentAcls = acls ? acls : this.props.acls;
			currentAcls.forEach(acl => {
				let pattern = /.*\/Channel\/Application\/(.*)\/.*/;
				//Extract Org_MSP from pattern /Channel/Application/Org_MSP/Role
				let policy_msp = acl.definition.match(pattern) && acl.definition.match(pattern)[1] ? acl.definition.match(pattern)[1] : null;
				if (policy_msp && !currentOrgs.includes(policy_msp)) {
					errors.push({
						definition: acl.definition,
						org: policy_msp,
					});
				}
			});
			this.props.updateState(SCOPE, {
				aclErrors: errors,
			});
		}
	};

	isAnyCapabilityModified = () => {
		let selectedOrdererCapability =
			this.props.selectedOrdererCapability && typeof this.props.selectedOrdererCapability === 'object' ? this.props.selectedOrdererCapability.id : null;
		let selectedChannelCapability =
			this.props.selectedChannelCapability && typeof this.props.selectedChannelCapability === 'object' ? this.props.selectedChannelCapability.id : null;
		if (!this.props.isChannelUpdate) {
			return (
				(!_.isEmpty(selectedOrdererCapability) && selectedOrdererCapability !== 'use_default') ||
				(!_.isEmpty(selectedChannelCapability) && selectedChannelCapability !== 'use_default')
			);
		} else {
			return (
				(selectedOrdererCapability && selectedOrdererCapability !== this.props.existingCapabilities.orderer) ||
				(selectedChannelCapability && selectedChannelCapability !== this.props.existingCapabilities.channel)
			);
		}
	};

	isAnyBlockParamModified = () => {
		if (!this.props.isChannelUpdate) {
			return this.props.overrideDefaults;
		} else {
			return (
				(this.props.absolute_max_bytes && bytes.parse(this.props.absolute_max_bytes) !== bytes.parse(this.props.existingBlockParams.absolute_max_bytes)) ||
				(this.props.max_message_count && this.props.max_message_count !== this.props.existingBlockParams.max_message_count) ||
				(this.props.preferred_max_bytes && bytes.parse(this.props.preferred_max_bytes) !== bytes.parse(this.props.existingBlockParams.preferred_max_bytes)) ||
				(this.props.timeout && parse(this.props.timeout) !== parse(this.props.existingBlockParams.timeout))
			);
		}
	};

	isAnyRaftParamModified = () => {
		if (!this.props.isChannelUpdate) {
			return this.props.use_default_consenters ? false : this.props.overrideRaftDefaults;
		} else {
			return (
				this.props.snapshot_interval_size &&
				bytes.parse(this.props.snapshot_interval_size) !== bytes.parse(this.props.existingRaftParams.snapshot_interval_size)
				/* || (this.props.election_tick && this.props.election_tick !== this.props.existingRaftParams.election_tick) ||
					(this.props.heartbeat_tick && this.props.heartbeat_tick !== this.props.existingRaftParams.heartbeat_tick) ||
					(this.props.max_inflight_blocks && this.props.max_inflight_blocks !== this.props.existingRaftParams.max_inflight_blocks) ||
					(this.props.tick_interval && parse(this.props.tick_interval) !== parse(this.props.existingRaftParams.tick_interval)) */
			);
		}
	};

	createChannel = () => {
		let organizations = {};
		this.props.orgs
			.filter(org => org.msp !== '')
			.forEach(org => {
				organizations[org.msp] = {
					msp_id: org.msp,
					roles: org.roles,
					host_url: org.host_url,
					admins: org.admins,
				};
			});
		let acls = {};
		this.props.acls.forEach(acl => {
			acls[acl.resource] = acl.definition;
		});
		let orderer_msps = [];
		if (this.props.selectedOrdererMsp && this.props.selectedOrdererMsp.host_url) {
			orderer_msps.push({
				msp_id: this.props.selectedOrdererMsp.msp_id,
				admins: this.props.selectedOrdererMsp.admins,
				host_url: this.props.selectedOrdererMsp.host_url,
			});
		}
		let block_params;
		if (this.isAnyBlockParamModified()) {
			block_params = {
				absolute_max_bytes: this.props.absolute_max_bytes ? parseInt(this.props.absolute_max_bytes) : null,
				max_message_count: this.props.max_message_count ? parseInt(this.props.max_message_count) : null,
				preferred_max_bytes: this.props.preferred_max_bytes ? parseInt(this.props.preferred_max_bytes) : null,
				timeout: this.props.timeout,
			};
		}
		let raft_params;
		if (this.isAnyRaftParamModified()) {
			raft_params = {
				snapshot_interval_size: this.props.snapshot_interval_size ? parseInt(this.props.snapshot_interval_size) : null,
				/* election_tick: this.props.election_tick ? parseInt(this.props.election_tick) : null,
				heartbeat_tick: this.props.heartbeat_tick ? parseInt(this.props.heartbeat_tick) : null,
				max_inflight_blocks: this.props.max_inflight_blocks ? parseInt(this.props.max_inflight_blocks) : null,
				tick_interval: this.props.tick_interval, */
			};
		}
		let selectedOrdererCapability =
			this.props.selectedOrdererCapability &&
			typeof this.props.selectedOrdererCapability === 'object' &&
			this.props.selectedOrdererCapability.id !== 'use_default'
				? this.props.selectedOrdererCapability.id
				: null;
		let selectedChannelCapability =
			this.props.selectedChannelCapability &&
			typeof this.props.selectedChannelCapability === 'object' &&
			this.props.selectedChannelCapability.id !== 'use_default'
				? this.props.selectedChannelCapability.id
				: null;
		let selectedApplicationCapability =
			this.props.selectedApplicationCapability &&
			typeof this.props.selectedApplicationCapability === 'object' &&
			this.props.selectedApplicationCapability.id !== 'use_default'
				? this.props.selectedApplicationCapability.id
				: constants.DEFAULT_APPLICATION_CAPABILITY;
		let orderer_urls = [];
		if (this.isConsenterSetModified() && _.has(this.props.selectedOrderer, 'raft')) {
			this.props.selectedOrderer.raft.forEach(node => {
				let isConsenter = this.props.consenters.find(x => x.host + ':' + x.port === node.backend_addr && x.name === node.display_name);
				if (isConsenter) {
					orderer_urls.push(node.backend_addr);
				}
			});
		} else if (_.has(this.props.selectedOrderer, 'raft')) {
			this.props.selectedOrderer.raft.forEach(x => orderer_urls.push(x.backend_addr));
		} else {
			orderer_urls.push(this.props.selectedOrderer.backend_addr);
		}
		let options = {
			channel_id: this.props.channelName,
			org_msp_id: this.props.selectedChannelCreator.msp_id,
			application_msps: organizations,
			orderer_url: this.props.selectedOrderer.url2use,
			all_orderer_urls: orderer_urls,
			orderer_msp: this.props.selectedOrderer.msp_id,
			client_cert_b64pem: this.props.selectedIdentity ? this.props.selectedIdentity.cert : null,
			client_prv_key_b64pem: this.props.selectedIdentity ? this.props.selectedIdentity.private_key : null,
			configtxlator_url: this.props.configtxlator_url,
			acls: acls,
			n_out_of: this.props.customPolicy ? this.props.customPolicy.id : 1,
			orderer_msps: orderer_msps,
			block_params: block_params,
			raft_params: raft_params,
			consenters: this.props.use_default_consenters ? [] : this.props.consenters,
		};
		if (selectedApplicationCapability) {
			options.application_capabilities = [selectedApplicationCapability];
		}
		if (selectedChannelCapability) {
			options.channel_capabilities = [selectedChannelCapability];
		}
		if (selectedOrdererCapability) {
			options.orderer_capabilities = [selectedOrdererCapability];
		}
		if (selectedApplicationCapability && selectedApplicationCapability.indexOf('V2_0') !== -1) {
			this.buildChaincodePolicyOptions(options, 'lifecycle_policy');
			this.buildChaincodePolicyOptions(options, 'endorsement_policy');
		}
		Log.debug('Sending request to create new channel: ', options);

		this.props.updateState(SCOPE, {
			submitting: true,
			createChannelError: null,
		});
		ChannelApi.createAppChannel(options)
			.then(resp => {
				Log.debug('Channel was created successfully: ', resp);
				if (window.trackEvent) {
					window.trackEvent('Created Object', {
						objectType: 'Channel',
						object: options.channel_id,
						tenantId: this.props.CRN.instance_id,
						accountGuid: this.props.CRN.account_id,
						milestoneName: 'Create a channel',
						url: options.orderer_url,
						'user.email': this.props.userInfo.email,
					});
				}
				this.props.updateState(SCOPE, {
					submitting: false,
				});
				this.sidePanel.closeSidePanel();
				this.props.onComplete(this.props.channelName, resp ? resp.isOrdererSignatureNeeded : null);
				triggerSurvey(triggers.CREATE_CHANNEL);
			})
			.catch(error => {
				Log.error(error);
				let error_msg = 'error_create_channel';
				if (error && error.grpc_resp && error.grpc_resp.statusMessage) {
					if (
						error.grpc_resp.statusMessage.indexOf('but got version') !== -1 ||
						error.grpc_resp.statusMessage.indexOf('be at version 0, but it is currently at version 1') !== -1
					) {
						error_msg = 'channel_error_exists';
					}
					if (
						error.grpc_resp.statusMessage.indexOf('existing config does not contain element for') !== -1 ||
						error.grpc_resp.statusMessage.indexOf('Attempted to include a member which is not in the consortium') !== -1
					) {
						error_msg = 'channel_error_nomember';
					}
				} else if (error.message_key) {
					error_msg = error.message_key;
				}
				this.props.updateState(SCOPE, {
					submitting: false,
					createChannelError: {
						title: error_msg,
						details: error,
					},
				});
			});
	};

	updateChannel = async() => {
		let existing_msps = {};
		this.props.existingOrgs.forEach(org => {
			const msp = this.props.msps.find(x => x.msp_id === org.id && _.intersection(x.root_certs, org.root_certs).length >= 1);
			existing_msps[org.id] = {
				msp_id: org.id,
				roles: org.roles,
				host_url: msp ? msp.host_url : org.host_url,
				admins: org.admins,
			};
		});
		let existing_orderer_msps = {};
		this.props.existingOrdererOrgs.forEach(org => {
			const msp = this.props.msps.find(x => x.msp_id === org.id && _.intersection(x.root_certs, org.root_certs).length >= 1);
			existing_orderer_msps[org.id] = {
				msp_id: org.id,
				roles: org.roles,
				host_url: msp ? msp.host_url : org.host_url,
				admins: org.admins,
			};
		});
		let updated_msps = {};
		this.props.orgs
			.filter(org => org.msp !== '')
			.forEach(org => {
				updated_msps[org.msp] = {
					roles: org.roles,
					msp_id: org.msp,
					// Match MSP's based on msp_id, admins(certs) and root certs
					msp_definition: this.props.msps.find(x => x.msp_id === org.msp && _.intersection(x.root_certs, org.root_certs).length >= 1),
					host_url: org.host_url,
					admins: org.admins,
				};
			});
		let updated_orderer_msps = {};
		this.props.orderer_orgs
			.filter(org => org.id !== '')
			.forEach(org => {
				updated_orderer_msps[org.msp_id] = {
					msp_id: org.msp_id,
					// Match MSP's based on msp_id, admins(certs) and root certs
					msp_definition: this.props.msps.find(x => x.msp_id === org.msp_id && _.intersection(x.root_certs, org.root_certs).length >= 1),
					host_url: org.host_url,
					admins: org.admins,
				};
			});
		let acls = {};
		this.props.acls.forEach(acl => {
			acls[acl.resource] = acl.definition;
		});
		let orderer_msps = [];
		if (this.props.selectedOrdererMsp && this.props.selectedOrdererMsp.host_url) {
			orderer_msps.push({
				msp_id: this.props.selectedOrdererMsp.msp_id,
				admins: this.props.selectedOrdererMsp.admins,
				host_url: this.props.selectedOrdererMsp.host_url,
			});
		}
		let block_params = {};
		if (this.isAnyBlockParamModified()) {
			block_params = {
				absolute_max_bytes: this.props.absolute_max_bytes ? parseInt(this.props.absolute_max_bytes) : null,
				max_message_count: this.props.max_message_count ? parseInt(this.props.max_message_count) : null,
				preferred_max_bytes: this.props.preferred_max_bytes ? parseInt(this.props.preferred_max_bytes) : null,
				timeout: this.props.timeout,
			};
		}
		let raft_params = {};
		if (this.isAnyRaftParamModified()) {
			raft_params = {
				snapshot_interval_size: this.props.snapshot_interval_size ? parseInt(this.props.snapshot_interval_size) : null,
				/* election_tick: this.props.election_tick ? parseInt(this.props.election_tick) : null,
				heartbeat_tick: this.props.heartbeat_tick ? parseInt(this.props.heartbeat_tick) : null,
				max_inflight_blocks: this.props.max_inflight_blocks ? parseInt(this.props.max_inflight_blocks) : null,
				tick_interval: this.props.tick_interval, */
			};
		}
		let selectedOrdererCapability =
			this.props.selectedOrdererCapability &&
			typeof this.props.selectedOrdererCapability === 'object' &&
			this.props.selectedOrdererCapability.id !== 'use_default'
				? this.props.selectedOrdererCapability.id
				: null;
		let selectedChannelCapability =
			this.props.selectedChannelCapability &&
			typeof this.props.selectedChannelCapability === 'object' &&
			this.props.selectedChannelCapability.id !== 'use_default'
				? this.props.selectedChannelCapability.id
				: null;
		let selectedApplicationCapability =
			this.props.selectedApplicationCapability &&
			typeof this.props.selectedApplicationCapability === 'object' &&
			this.props.selectedApplicationCapability.id !== 'use_default'
				? this.props.selectedApplicationCapability.id
				: null;
		let isAdmin = false;
		this.props.original_orgs.forEach(org => {
			if (org.msp === this.props.selectedChannelCreator.msp_id) {
				if (_.intersection(org.root_certs, this.props.selectedChannelCreator.root_certs).length >= 1) {
					if (org.roles.indexOf('admin') > -1) {
						isAdmin = true;
					}
				}
			}
		});

		this.props.updateState(SCOPE, {
			submitting: true,
			createChannelError: null,
		});

		let options = {
			channel_id: this.props.channelName,
			msp_id: this.props.selectedChannelCreator.msp_id,
			existing_application_msps: existing_msps,
			updated_application_msps: updated_msps,
			existing_orderer_msps,
			updated_orderer_msps,
			orderer_msps: orderer_msps,
			orderer_host: await OrdererRestApi.getOrdererURL(this.props.selectedOrderer, this.props.existingConsenters),
			acls: acls,
			client_cert_b64pem: this.props.selectedIdentity ? this.props.selectedIdentity.cert : null,
			client_prv_key_b64pem: this.props.selectedIdentity ? this.props.selectedIdentity.private_key : null,
			configtxlator_url: this.props.configtxlator_url,
			n_out_of: this.props.customPolicy ? this.props.customPolicy.id : this.props.nOutOf.n,
			block_params: block_params,
			raft_params: raft_params,
			channel_capabilities:
				!selectedChannelCapability || selectedChannelCapability === this.props.existingCapabilities.channel ? null : [selectedChannelCapability],
			application_capabilities:
				!selectedApplicationCapability || selectedApplicationCapability === this.props.existingCapabilities.application
					? null
					: [selectedApplicationCapability],
			orderer_capabilities:
				!selectedOrdererCapability || selectedOrdererCapability === this.props.existingCapabilities.orderer ? null : [selectedOrdererCapability],
			consenters: this.isConsenterSetModified() ? this.props.consenters : [],
			isAdmin,
		};

		if (
			(selectedApplicationCapability && selectedApplicationCapability.indexOf('V2_0') !== -1) ||
			this.props.existingCapabilities.application.indexOf('V2.0') !== -1
		) {
			this.buildChaincodePolicyOptions(options, 'lifecycle_policy');
			this.buildChaincodePolicyOptions(options, 'endorsement_policy');
		}
		Log.debug('Sending request to update channel: ', this.props.channelName, options);

		ChannelApi.updateAppChannel(options)
			.then(resp => {
				Log.debug('Channel was updated successfully: ', resp);
				this.sidePanel.closeSidePanel();
				this.props.onComplete(this.props.channelName);
				triggerSurvey(triggers.CREATE_CHANNEL);
			})
			.catch(error => {
				Log.error(error);
				let error_msg = 'error_update_channel';
				let details = error.message;
				if (typeof error === 'string') {
					if (error.indexOf('no differences detected between original and updated config') >= 0) {
						error_msg = 'no_changes';
					}
				} else if (error && error.grpc_resp && error.grpc_resp.statusMessage) {
					if (error.grpc_resp.statusMessage.indexOf('existing config does not contain element for') !== -1) {
						error_msg = 'channel_error_nomember';
					}
					if (error.grpc_resp.statusMessage.indexOf('no Raft leader') !== -1) {
						error_msg = 'error_no_raft_leader';
						details = _.get(error, 'grpc_resp.statusMessage');
					}
					if (error.grpc_resp.status === 503 && error.stitch_msg && error.stitch_msg.indexOf('unable to get block') !== -1) {
						error_msg = 'orderer_unavailable_consenter_update';
						details = _.get(error, 'grpc_resp.statusMessage');
					}
					if (error.grpc_resp.status === 403) {
						details = _.get(error, 'grpc_resp.statusMessage');
					}
				}
				this.props.updateState(SCOPE, {
					submitting: false,
					createChannelError: {
						title: error_msg,
						details: details,
					},
				});
			});
	};

	buildChaincodePolicyOptions = (options, policy) => {
		let type = this.props[policy].type;
		let members = type === 'SPECIFIC' && this.props[policy].members;
		let n = type === 'SPECIFIC' && this.props[policy].n;
		if (type === 'SPECIFIC' && _.size(members) === 0) {
			type = 'MAJORITY';
		}
		options[policy] = {
			type: type || 'MAJORITY',
			members: members || [],
			n: n || '',
		};
	};

	renderChannelTimeline(translate) {
		const { onClose, timelineSteps, timelineLoading, selectedTimelineStep, isChannelUpdate, advanced } = this.props;
		if (!timelineSteps || timelineLoading) return;
		let isOrdererSignatureNeeded =
			this.isAnyCapabilityModified() ||
			this.isAnyBlockParamModified() ||
			this.isConsenterSetModified() ||
			this.isAdminsModified() ||
			this.isAnyRaftParamModified();
		let updatedSteps = [];
		const isChannel2_0 = this.isChannel2_0();
		if (advanced) {
			timelineSteps.forEach(group => {
				group.forEach(subGroup => {
					if (subGroup.groupTitle === 'advanced_configuration') {
						subGroup.groupSteps.forEach(step => {
							if (step.label === 'ordering_service_organization') {
								step.disabled = !isOrdererSignatureNeeded;
							}
							if (step.label === 'channel_lifecycle_policy' || step.label === 'channel_endorsement_policy') {
								step.disabled = !isChannel2_0;
							}
						});
					}
				});
				updatedSteps.push(group);
			});
		} else {
			updatedSteps = timelineSteps;
		}
		return (
			<Timeline
				steps={updatedSteps}
				onClose={onClose}
				selectedTimelineStep={selectedTimelineStep}
				header={isChannelUpdate ? translate('update_channel') : translate('create_channel')}
				estTime={isChannelUpdate ? '' : translate('ten_min_setup')}
				progressWithChecks={false}
			/>
		);
	}

	renderSection = (translate, section) => {
		const { viewing, existingConsenters, existingOrdererOrgs, channelOrderer, existingCapabilities, existingBlockParams } = this.props;
		let isCapabilityModified = this.isAnyCapabilityModified();
		let isBlockParamModified = this.isAnyBlockParamModified();
		let isConsenterSetModified = this.isConsenterSetModified();
		let isAdminsModified = this.isAdminsModified();
		let isChannel2_0 = this.isChannel2_0();
		let isRaftParamModified = this.isAnyRaftParamModified();
		let isOrdererSignatureNeeded = isCapabilityModified || isBlockParamModified || isConsenterSetModified || isAdminsModified || isRaftParamModified;
		const canModifyConsenters = this.canModifyConsenters();
		const consenterUpdateCount = this.consenterUpdateCount();
		if (viewing !== section) return;
		return (
			<FocusComponent setFocus={this.props.setFocus}>
				{viewing === 'prerequisites' && (
					<Prerequisites
						getOrderingServiceDetails={this.getOrderingServiceDetails}
						isOrdererSignatureNeeded={isOrdererSignatureNeeded}
						isChannel2_0={isChannel2_0}
					/>
				)}
				{viewing === 'channel_details' && (
					<Details channelOrderer={channelOrderer}
						getOrderingServiceDetails={this.getOrderingServiceDetails}
						checkHealth={this.checkHealth}
					/>
				)}
				{viewing === 'channel_organizations' && (
					<Organizations updatePolicyDropdown={this.updatePolicyDropdown}
						verifyACLPolicyValidity={this.verifyACLPolicyValidity}
					/>
				)}
				{viewing === 'channel_update_policy' && <Policy />}
				{(viewing === 'organization_creating_channel' || viewing === 'organization_updating_channel') && <OrgSignature editLoading={this.props.editLoading} />}
				{viewing === 'capabilities' && <Capabilities existingCapabilities={existingCapabilities}
					channelPeers={this.props.channelPeers}
				/>}
				{viewing === 'lifecycle_policy' && (
					<ChaincodePolicy
						policy={'lifecycle_policy'}
						orgs={this.props.orgs.map(x => x.msp)}
						setType={this.setLifecyclePolicyType}
						setMembers={this.setLifecyclePolicyMembers}
					/>
				)}
				{viewing === 'endorsement_policy' && (
					<ChaincodePolicy
						policy={'endorsement_policy'}
						orgs={this.props.orgs.map(x => x.msp)}
						setType={this.setEndorsementPolicyType}
						setMembers={this.setEndorsementPolicyMembers}
					/>
				)}
				{viewing === 'block_cutting_params' && <BlockCuttingParams existingBlockParams={existingBlockParams} />}
				{viewing === 'orderer_admin_set' && <Admins isAdminsModified={isAdminsModified}
					existingOrdererOrgs={existingOrdererOrgs}
				/>}
				{viewing === 'consenter_set' && (
					<Consenters
						existingConsenters={existingConsenters}
						isConsenterSetModified={this.isConsenterSetModified}
						consenterUpdateCount={consenterUpdateCount}
					/>
				)}
				{viewing === 'ordering_service_organization' && (
					<OrdererSignature isOrdererSignatureNeeded={isOrdererSignatureNeeded}
						isCapabilityModified={isCapabilityModified}
					/>
				)}
				{viewing === 'channel_acls' && <ACL verifyACLPolicyValidity={this.verifyACLPolicyValidity} />}
				{viewing === 'review_channel_info' && (
					<Review
						advanced
						isOrdererSignatureNeeded={isOrdererSignatureNeeded}
						consenterUpdateCount={this.consenterUpdateCount}
						canModifyConsenters={canModifyConsenters}
					/>
				)}
			</FocusComponent>
		);
	};

	render() {
		const isHigherCapabilityAvailable = this.isAnyHigherCapabilityAvailable();
		const canModifyConsenters = this.canModifyConsenters();
		const { isChannelUpdate, translate } = this.props;
		return (
			<SidePanel
				id="ibp--template-full-page-side-panel"
				closed={this.props.onClose}
				onSubmit={this.onSubmit}
				ref={sidePanel => (this.sidePanel = sidePanel)}
				buttons={this.getButtons(translate)}
				error={this.props.createChannelError}
				submitting={this.props.submitting}
				verticalPanel
			>
				<div className="ibp-channel-modal">
					{this.renderChannelTimeline(translate)}
					<div className="ibp-channel-modal-content">
						{!isChannelUpdate && this.renderSection(translate, 'prerequisites')}
						{!isChannelUpdate && this.renderSection(translate, 'channel_details')}
						{this.renderSection(translate, 'channel_organizations')}
						{this.renderSection(translate, 'channel_update_policy')}
						{!isChannelUpdate && this.renderSection(translate, 'organization_creating_channel')}
						{isChannelUpdate && this.renderSection(translate, 'organization_updating_channel')}
						{isHigherCapabilityAvailable && this.renderSection(translate, 'capabilities')}
						{this.renderSection(translate, 'lifecycle_policy')}
						{this.renderSection(translate, 'endorsement_policy')}
						{this.renderSection(translate, 'block_cutting_params')}
						{isChannelUpdate && canModifyConsenters && this.renderSection(translate, 'orderer_admin_set')}
						{canModifyConsenters && this.renderSection(translate, 'consenter_set')}
						{this.renderSection(translate, 'ordering_service_organization')}
						{this.renderSection(translate, 'channel_acls')}
						{this.renderSection(translate, 'review_channel_info')}
					</div>
				</div>
			</SidePanel>
		);
	}
}

const dataProps = {
	timelineSteps: PropTypes.array,
	selectedTimelineStep: PropTypes.object,
	timelineLoading: PropTypes.bool,
	viewing: PropTypes.string,
	channelName: PropTypes.string,
	channelId: PropTypes.string,
	selectedIdentity: PropTypes.object,
	selectedOrdererMsp: PropTypes.object, // needed to sign the request when updating block params
	selectedOrderer: PropTypes.any,
	raftNodes: PropTypes.array,
	consenters: PropTypes.array,
	selectedConsenter: PropTypes.object,
	selectedChannelCreator: PropTypes.any,
	msps: PropTypes.array,
	orgs: PropTypes.array,
	orderer_orgs: PropTypes.array,
	loading: PropTypes.bool,
	submitting: PropTypes.bool,
	orderers: PropTypes.array,
	channelOrderer: PropTypes.array,
	identities: PropTypes.array,
	channelNameError: PropTypes.string,
	noOperatorError: PropTypes.string,
	duplicateMSPError: PropTypes.string,
	isOrdererUnavailable: PropTypes.bool,
	isTLSUnavailable: PropTypes.bool,
	checkingOrdererStatus: PropTypes.bool,
	createChannelError: PropTypes.any,
	missingDefinitionError: PropTypes.string,
	existingOrgs: PropTypes.array,
	existingOrdererOrgs: PropTypes.array,
	existingAcls: PropTypes.array,
	selectedOrg: PropTypes.object,
	isChannelUpdate: PropTypes.bool,
	availableACLResources: PropTypes.array,
	availableACLPolicies: PropTypes.array,
	availableACLRoles: PropTypes.array,
	selectedACLResource: PropTypes.object,
	selectedACLPolicy: PropTypes.object,
	selectedACLRole: PropTypes.object,
	acls: PropTypes.array,
	aclErrors: PropTypes.array,
	memberCounts: PropTypes.array,
	absolute_max_bytes: PropTypes.number,
	max_message_count: PropTypes.number,
	preferred_max_bytes: PropTypes.number,
	timeout: PropTypes.string,
	customPolicy: PropTypes.object,
	customPolicyDefault: PropTypes.object,
	nOutOf: PropTypes.object,
	existingBlockParams: PropTypes.object,
	availableChannelCapabilities: PropTypes.array,
	availableApplicationCapabilities: PropTypes.array,
	availableOrdererCapabilities: PropTypes.array,
	selectedApplicationCapability: PropTypes.object,
	selectedChannelCapability: PropTypes.object,
	selectedOrdererCapability: PropTypes.object,
	advanced: PropTypes.bool,
	updateOrdererDefError: PropTypes.bool,
	loadingConsenters: PropTypes.bool,
	tick_interval: PropTypes.string,
	election_tick: PropTypes.number,
	heartbeat_tick: PropTypes.number,
	max_inflight_blocks: PropTypes.number,
	snapshot_interval_size: PropTypes.number,
	overrideDefaults: PropTypes.bool,
	overrideRaftDefaults: PropTypes.bool,
	setFocus: PropTypes.bool,
	availableAdmins: PropTypes.array,
	invalid_consenter: PropTypes.bool,
	original_orgs: PropTypes.array,
	use_default_consenters: PropTypes.bool,
	channel_warning_20: PropTypes.bool,
	channel_warning_20_details: PropTypes.array,
	nodeou_warning: PropTypes.bool,
	lifecycle_policy: PropTypes.object,
	endorsement_policy: PropTypes.object,
};

ChannelModal.propTypes = {
	...dataProps,
	updateState: PropTypes.func,
	closed: PropTypes.func,
	translate: PropTypes.func, // Provided by withLocalize
	editLoading: PropTypes.bool,
};

export default connect(
	state => {
		let newProps = Helper.mapStateToProps(state[SCOPE], dataProps);
		newProps['configtxlator_url'] = _.get(state, 'settings.configtxlator_url');
		newProps['CRN'] = _.get(state, 'settings.CRN');
		newProps['userInfo'] = _.get(state, 'userInfo.loggedInAs');
		newProps['capabilitiesEnabled'] = _.get(state, 'settings.feature_flags.capabilities_enabled');
		newProps['capabilities'] = _.get(state, 'settings.capabilities');
		newProps['scaleRaftNodesEnabled'] = _.get(state, 'settings.feature_flags.scale_raft_nodes_enabled');
		return newProps;
	},
	{
		updateState,
	}
)(withLocalize(ChannelModal));