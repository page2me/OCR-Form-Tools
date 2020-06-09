// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import React from "react";
import { connect } from "react-redux";
import { RouteComponentProps } from "react-router-dom";
import { bindActionCreators } from "redux";
import { FontIcon, PrimaryButton, Spinner, SpinnerSize} from "office-ui-fabric-react";
import IProjectActions, * as projectActions from "../../../../redux/actions/projectActions";
import IApplicationActions, * as applicationActions from "../../../../redux/actions/applicationActions";
import IAppTitleActions, * as appTitleActions from "../../../../redux/actions/appTitleActions";
import {
    IApplicationState, IConnection, IProject, IAppSettings, FieldType, IAssetMetadata, IGenerator, ILabel,
} from "../../../../models/applicationState";
import TrainChart from "./trainChart";
import TrainPanel from "./trainPanel";
import TrainTable from "./trainTable";
import { ITrainRecordProps } from "./trainRecord";
import "./trainPage.scss";
import { strings } from "../../../../common/strings";
import { constants } from "../../../../common/constants";
import _ from "lodash";
import Alert from "../../common/alert/alert";
import url from "url";
import PreventLeaving from "../../common/preventLeaving/preventLeaving";
import ServiceHelper from "../../../../services/serviceHelper";
import { getPrimaryGreenTheme } from "../../../../common/themes";
import { SkipButton } from "../../shell/skipButton";
import { AssetService } from "../../../../services/assetService";
import ProjectService from "../../../../services/projectService";
import Guard from "../../../../common/guard";
import { generate } from "../../common/generators/generateUtils";
import { OCRService } from "../../../../services/ocrService";

export interface ITrainPageProps extends RouteComponentProps, React.Props<TrainPage> {
    connections: IConnection[];
    appSettings: IAppSettings;
    project: IProject;
    actions: IProjectActions;
    applicationActions: IApplicationActions;
    recentProjects: IProject[];
    appTitleActions: IAppTitleActions;
}

export interface ITrainPageState {
    trainMessage: string;
    isTraining: boolean;
    currTrainRecord: ITrainRecordProps;
    viewType: "chartView" | "tableView";
    showTrainingFailedWarning: boolean;
    trainingFailedMessage: string;
    hasCheckbox: boolean;
}

interface ITrainApiResponse {
    modelId: string;
    createdDateTime: string;
    averageModelAccuracy: number;
    fields: object[];
}

function mapStateToProps(state: IApplicationState) {
    return {
        appSettings: state.appSettings,
        project: state.currentProject,
        connections: state.connections,
        recentProjects: state.recentProjects,
    };
}

function mapDispatchToProps(dispatch) {
    return {
        actions: bindActionCreators(projectActions, dispatch),
        applicationActions: bindActionCreators(applicationActions, dispatch),
        appTitleActions: bindActionCreators(appTitleActions, dispatch),
    };
}

@connect(mapStateToProps, mapDispatchToProps)
export default class TrainPage extends React.Component<ITrainPageProps, ITrainPageState> {

    constructor(props) {
        super(props);

        this.state = {
            trainMessage: strings.train.notTrainedYet,
            isTraining: false,
            currTrainRecord: null,
            viewType: "tableView",
            showTrainingFailedWarning: false,
            trainingFailedMessage: "",
            hasCheckbox: false,
        };
    }

    public async componentDidMount() {
        const projectId = this.props.match.params["projectId"];
        if (projectId) {
            const project = this.props.recentProjects.find((project) => project.id === projectId);
            await this.props.actions.loadProject(project);

            this.props.appTitleActions.setTitle(project.name);

            this.showCheckboxPreview(project);
            this.updateCurrTrainRecord(this.getProjectTrainRecord());
        }
        document.title = strings.train.title + " - " + strings.appName;
    }

    public render() {
        const currTrainRecord = this.state.currTrainRecord;

        return (
            <div className="train-page skipToMainContent" id="pageTrain">
                <main className="train-page-main">
                    {currTrainRecord &&
                        <div>
                            <h3> Train Result </h3>
                            <span> Model ID: {currTrainRecord.modelInfo.modelId} </span>
                        </div>
                    }
                    {this.state.viewType === "tableView" &&
                        <TrainTable
                            trainMessage={this.state.trainMessage}
                            accuracies={currTrainRecord && currTrainRecord.accuracies} />}

                    {this.state.viewType === "chartView" && currTrainRecord &&
                        <TrainChart
                            accuracies={currTrainRecord.accuracies}
                            modelId={currTrainRecord.modelInfo.modelId}
                            projectTags={this.props.project.tags} />
                    }
                </main>
                <div className="train-page-menu bg-lighter-1">
                    <div className="condensed-list">
                        <div className="condensed-list-body">
                            <div className="m-3">
                                <h4 className="text-shadow-none"> Train a new model </h4>
                                {this.state.hasCheckbox &&
                                    <div className="alert alert-warning warning train-notification">
                                        <FontIcon iconName="WarningSolid"></FontIcon>
                                        <span className="train-notification-text">
                                            {strings.train.backEndNotAvailable}
                                        </span>
                                    </div>}
                                {!this.state.isTraining ? (
                                    <PrimaryButton
                                        id="train_trainButton"
                                        theme={getPrimaryGreenTheme()}
                                        autoFocus={true}
                                        className="flex-center"
                                        onClick={this.handleTrainClick}>
                                        <FontIcon iconName="MachineLearning" />
                                        <h6 className="d-inline text-shadow-none ml-2 mb-0"> {strings.train.title} </h6>
                                    </PrimaryButton>
                                ) : (
                                    <div className="loading-container">
                                        <Spinner
                                            label="Training in progress..."
                                            ariaLive="assertive"
                                            labelPosition="right"
                                            size={SpinnerSize.large}
                                        />
                                    </div>
                                )
                                }
                            </div>
                            <div className={!this.state.isTraining ? "" : "greyOut"}>
                                {currTrainRecord &&
                                    <TrainPanel
                                        currTrainRecord={currTrainRecord}
                                        viewType={this.state.viewType}
                                        updateViewTypeCallback={this.handleViewTypeClick}
                                    />
                                }
                            </div>
                        </div>
                    </div>
                </div>
                <Alert
                    show={this.state.showTrainingFailedWarning}
                    title="Training Failed"
                    message={this.state.trainingFailedMessage}
                    onClose={() => this.setState({ showTrainingFailedWarning: false })}
                />
                <PreventLeaving
                    when={this.state.isTraining}
                    message={"A training operation is currently in progress, are you sure you want to leave?"}
                />
            </div>
        );
    }

    private handleTrainClick = () => {
        this.setState({
            isTraining: true,
            trainMessage: strings.train.training,
        });

        this.trainProcess().then((trainResult) => {
            this.setState((prevState, props) => ({
                isTraining: false,
                trainMessage: this.getTrainMessage(trainResult),
                currTrainRecord: this.getProjectTrainRecord(),
            }));
        }).catch((err) => {
            this.setState({
                isTraining: false,
                trainMessage: err.message,
            });
        });
    }

    private handleViewTypeClick = (viewType: "tableView" | "chartView"): void => {
        this.setState({ viewType });
    }

    private async trainProcess(): Promise<any> {
        const shouldGenerate = true;
        try {
            let sourcePrefix = this.props.project.folderPath ? this.props.project.folderPath : "";
            if (shouldGenerate) {
                sourcePrefix = await this.generateValues(sourcePrefix);
            }
            const trainRes = await this.train(sourcePrefix);
            const trainStatusRes =
                await this.getTrainStatus(trainRes.headers["location"]);
            const updatedProject = this.buildUpdatedProject(
                this.parseTrainResult(trainStatusRes),
            );
            await this.props.actions.saveProject(updatedProject, false, false);

            return trainStatusRes;
        } catch (errorMessage) {
            this.setState({
                showTrainingFailedWarning: true,
                trainingFailedMessage: (errorMessage !== undefined && errorMessage.message !== undefined
                    ? errorMessage.message : errorMessage),
            });
        }
    }

    private async generateValues(sourcePrefix: string): Promise<string> {
        // Generate values from project generators and create a new folder with the appropriate data
        /**
         * copy files over to folder
         * write new pdfs
         * call ocr service to regen
         * proper shouldGenerate clause
         */
        const assets = this.props.project.assets;
        Guard.null(assets);
        const generatePath = sourcePrefix.concat("/generated");
        // We need to iterate through the assets to get generator information
        // This will need an update if we refactor
        const assetService = new AssetService(this.props.project);
        const projectService = new ProjectService();
        const ocrService = new OCRService(this.props.project);
        const metadataDict: {[key: string]: IAssetMetadata} = {}
        const metadatas = await Promise.all(Object.keys(assets).map(async (assetKey) => {
            const asset = assets[assetKey];
            const metadata = await assetService.getAssetMetadata(asset);
            metadataDict[assetKey] = metadata;
            return metadata;
        }));

        const allFields = [].concat.apply(this.props.project.tags, metadatas.map(m => m.generators));
        const fieldsPromise = projectService.saveFieldsFile(allFields, generatePath, assetService.storageProvider);
        const generatorLabels: {[key: string]: ILabel[][]} = {};
        Object.keys(metadataDict).forEach((assetKey) => {
            const metadata = metadataDict[assetKey];
            const generatorInfo: ILabel[][] = [];
            // each asset has generators, each of which corresponds to X ILabel[]
            // outer index is copy number
            for (let i = 0; i < metadata.generatorSettings.generateCount; i++) {
                generatorInfo.push(metadata.generators.map(this.generatorToLabel));
            }
            generatorLabels[assetKey] = generatorInfo;
        });
        const labelsAndOCRPromise = Promise.all(Object.keys(metadataDict).map(async (assetKey) => {
            const asset = assets[assetKey];
            const metadata = metadataDict[assetKey];
            const labelData = metadata.labelData; // precisely JSON.parse of the file
            const generatedLabelData = generatorLabels[assetKey];
            const baseLabels = [...labelData.labels]; // make a copy of the array, we don't need copies of the object
            const savePromises = [];
            for (let i = 0; i < metadata.generatorSettings.generateCount; i++) {
                const prefix = `${generatePath}/${i}_`;
                metadata.labelData.labels = baseLabels.concat(generatedLabelData[i]);
                savePromises.push(assetService.saveLabels(asset, metadata.labelData, prefix));
            }

            // * To update the ocr files, we can either edit them or edit the pdfs and re-invoke
            // * Choosing to edit the files directly, as pdfjslib doesn't support editing, and OL needs a canvas and saves to image
            const ocr = await ocrService.getRecognizedText(asset.path, asset.name);
            for (let i = 0; i < metadata.generatorSettings.generateCount; i++) {
                const prefix = `${generatePath}/${i}_`;
                // TODO modify OCR
                savePromises.push(assetService.saveOCR(asset, ocr, prefix));
            }
            return savePromises;
        }));

        await Promise.all([fieldsPromise, labelsAndOCRPromise]);
        // ! return generatePath;
        return sourcePrefix;
    }

    private generatorToLabel: (g: IGenerator) => ILabel = (generator) => {
        const generatedInfo = generate(generator);
        return { // TODO is there something else that puts this together?
            label: generator.name,
            key: null,
            value: [
                {
                    page: 1, // TODO anchor page
                    ...generatedInfo,
                }
            ]
        };
    }

    private async train(sourcePrefix: string): Promise<any> {
        const baseURL = url.resolve(
            this.props.project.apiUriBase,
            constants.apiModelsPath,
        );
        const provider = this.props.project.sourceConnection.providerOptions as any;
        const trainSourceURL = provider.sas;

        const payload = {
            source: trainSourceURL,
            sourceFilter: {
                prefix: sourcePrefix,
                includeSubFolders: false,
            },
            useLabelFile: true,
        };
        try {
            return await ServiceHelper.postWithAutoRetry(
                baseURL,
                payload,
                {},
                this.props.project.apiKey as string,
            );
        } catch (err) {
            ServiceHelper.handleServiceError(err);
        }
    }

    private async getTrainStatus(operationLocation: string): Promise<any> {
        const timeoutPerFileInMs = 10000;  // 10 second for each file
        const minimumTimeoutInMs = 300000;  // 5 minutes minimum waiting time  for each traingin process
        const extendedTimeoutInMs = timeoutPerFileInMs * Object.keys(this.props.project.assets || []).length;
        const res = this.poll(() => {
            return ServiceHelper.getWithAutoRetry(
                operationLocation,
                { headers: { "cache-control": "no-cache" } },
                this.props.project.apiKey as string);
        }, Math.max(extendedTimeoutInMs, minimumTimeoutInMs), 1000);

        return res;
    }

    private buildUpdatedProject = (newTrainRecord: ITrainRecordProps): IProject => {
        return {
            ...this.props.project,
            trainRecord: newTrainRecord,
        };
    }

    private getTrainMessage = (trainingResult): string => {
        if (trainingResult !== undefined && trainingResult.modelInfo !== undefined
            && trainingResult.modelInfo.status === "ready") {
            return "Trained successfully";
        }
        return "Training failed";
    }

    private getProjectTrainRecord = (): ITrainRecordProps => {
        return _.get(this, "props.project.trainRecord", null);
    }

    private updateCurrTrainRecord = (curr: ITrainRecordProps): void => {
        this.setState({ currTrainRecord: curr });
    }

    private parseTrainResult = (response: ITrainApiResponse): ITrainRecordProps => {
        return {
            modelInfo: {
                modelId: response["modelInfo"]["modelId"],
                createdDateTime: response["modelInfo"]["createdDateTime"],
            },
            averageAccuracy: response["trainResult"]["averageModelAccuracy"],
            accuracies: this.buildAccuracies(response["trainResult"]["fields"]),
        };
    }

    private buildAccuracies = (fields: object[]): object => {
        const accuracies = {};
        for (const field of fields) {
            accuracies[field["fieldName"]] = field["accuracy"];
        }
        return accuracies;
    }

    /**
     * Poll function to repeatly check if request succeeded
     * @param func - function that will be called repeatly
     * @param timeout - timeout
     * @param interval - interval
     */
    private poll = (func, timeout, interval): Promise<any> => {
        const endTime = Number(new Date()) + (timeout || 10000);
        interval = interval || 100;

        const checkSucceeded = (resolve, reject) => {
            const ajax = func();
            ajax.then((response) => {
                if (response.data.modelInfo && response.data.modelInfo.status === "ready") {
                    resolve(response.data);
                } else if (response.data.modelInfo && response.data.modelInfo.status === "invalid") {
                    const message = _.get(
                        response,
                        "data.trainResult.errors[0].message",
                        "Sorry, we got errors while training the model.");
                    reject(message);
                } else if (Number(new Date()) < endTime) {
                    // If the request isn't succeeded and the timeout hasn't elapsed, go again
                    setTimeout(checkSucceeded, interval, resolve, reject);
                } else {
                    // Didn't succeeded after too much time, reject
                    reject(new Error("Timed out, sorry, it seems the training process took too long."));
                }
            });
        };

        return new Promise(checkSucceeded);
    }

    private showCheckboxPreview = (project: IProject) => {
        if (project.tags.find((t) => t.type === FieldType.SelectionMark)) {
            this.setState({
                hasCheckbox: true,
            });
        }
    }
}
