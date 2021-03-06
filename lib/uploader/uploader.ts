import { EventEmitter } from 'eventemitter3';
import 'yet-another-abortcontroller-polyfill';

import { message } from 'antd';
import PLimit from '@/lib/limit/p-limit2';
import { toFileSlice, toErrorFileSlice, delay } from './upload';
import type { ChunkFile, ChunksStatusContent } from './upload';

import { FileStatus, GatherFileFlag, FileTopStatus } from './upload.type';

type Params = {
  concurrency?: number;
  file: File;
  taskId: string;
  chunkSize?: number;
  validFile?: string[];
  validFileSize?: number;
  retryCount?: number;
  retryChunkStatusCount?: number;
  retryFullFileCount?: number;
  // uploadChunkFileApi?: Function;
  // uploadFullFileApi?: Function;
  // getChunksStatusApi?: Function;
  // getFileContinueInfoApi?: Function;
  // changeUploadFileApi?: Function;
  // category: string;
  [str: string]: any;
};

type Options = {
  concurrency: number;
  file: File;
  chunkSize: number;
  taskId: string;
  validFile: string[];
  validFileSize: number;
  retryCount: number;
  retryChunkStatusCount: number;
  retryFullFileCount: number;
  // uploadChunkFileApi: Function;
  // uploadFullFileApi: Function;
  // getChunksStatusApi: Function;
  // getFileContinueInfoApi: Function;
  // changeUploadFileApi: Function;
  // category: string;
  status: string;
  [str: string]: any;
};


export default class UploadFile extends EventEmitter<
  | 'completedChunkEvent'
  | 'completedFileMd5Event'
  | 'nextEvent'
  | 'completedServerChunkStatusEvent'
> {
  options: Options;

  plimit: any;

  controller: AbortController | null;

  private _worker: any;

  private _chunks: ChunkFile[] = [];

  errorChunkList: ChunkFile[] = [];

  private _filemd5: string = '';

  private _filemd5Status: 'error' | 'successful' | '' = '';

  private retry: number = 0;

  private retryChunkStatusCount: number = 0;

  private retryFullFileCount: number = 0;

  private _finishSuccessCount: number = 0;

  private _needChunkMd5: boolean = true;

  status: FileStatus;

  constructor(params: Params) {
    super();
    this.options = {
      validFile: ['.zip', '.tar', '.tar.gz'],
      validFileSize: 10 * 1024 * 1024 * 1024,
      chunkSize: 5 * 1024 * 1024,
      concurrency: 3,
      retryCount: 3,
      retryChunkStatusCount: 5,
      retryFullFileCount: 5,
      status: '',
      ...params,
    };

    this.status = FileStatus.PENDING;

    this.controller = new AbortController();
    this.plimit = new PLimit({ concurrency: this.options.concurrency });
    this._worker = new Worker('./worker/filemd5.js');
    this._worker.onmessage = async (event: MessageEvent) => {
      if (event && event.data) {
        // ??????????????????MD5, ???????????????????????????
        const { md5 } = event.data;
        this._filemd5 = md5;
        if(this.options.status === FileTopStatus.FILERETRY) {
          this.emit('completedFileMd5Event', {
            md5,
            isFileRetry: true,
            status: 'ok',
          });
        } else {
          this._submitFullFillInfo(md5);
        }
      }
    };
  }

  

  // ???????????????????????????
  async _submitFullFillInfo(md5: string) {
    const { taskId, file, category } = this.options;
    const fullFileParams = {
      md5,
      taskId,
      totalSize: file.size,
      category,
      totalSlice: this._chunks.length,
      signal: this.controller?.signal,
    };
    try {
      const ret = await this.options.uploadFullFileApi(fullFileParams);
      const status = ret && ret.status === 'ok' ? 'ok' : 'error';
      if (status === 'ok') {
        this.emit('completedFileMd5Event', {
          ...fullFileParams,
          status,
        });
        this._filemd5Status = 'successful';
      } else {
        throw new Error('????????????????????????');
      }
    } catch (error) {
      if (this.retryFullFileCount < this.options.retryFullFileCount) {
        this.retryFullFileCount += 1;
        this._submitFullFillInfo(md5);
      }
      this._filemd5Status = 'error';
      this.emit('completedFileMd5Event', {
        ...fullFileParams,
        status: 'error',
      });
    }
  }

  // ??????
  async _toSliceChunk() {
    const { file, chunkSize } = this.options;
    const result = await toFileSlice(file, chunkSize);

    return result;
  }

  // ?????? fetch promise
  _handleUploadChunk(data: ChunkFile, chunksLen: number) {
    return () =>
      this.options.uploadChunkFileApi({
        file: data.file,
        md5: data.md5,
        uploadTaskId: this.options.taskId,
        category: this.options.category,
        index: data.index,
        chunkSize: data.chunkSize,
        chunks: chunksLen,
        signal: this.controller?.signal,
      });
  }

  // chunk limit
  _promiseFetchs(
    chunks: ChunkFile[],
    isRetry?: boolean,
    retrySuccessfulCount?: number,
  ) {
    const that = this;
    return chunks.map((item: ChunkFile) =>
      this.plimit.add(
        this._handleUploadChunk(item, this._chunks.length),
        (successfulCount: number) => {
          that._finishSuccessCount += successfulCount;

          that.emit('completedChunkEvent', {
            taskId: this.options.taskId,
            successfulCount: isRetry
              ? that._finishSuccessCount + retrySuccessfulCount!
              : that._finishSuccessCount,
            totalCount: that._chunks.length,
            category: this.options.category,
          });
        },
      ),
    );
  }

  // commit chunk and retry commit chunk
  runEnd(errorChunkList: ChunkFile[]) {
    if(this.status !== FileStatus.DELETE) {
      this.errorChunkList = errorChunkList;
      console.log('errorChunkList', this.options.file.name, errorChunkList);
      this.status = FileStatus.LOCAL_CHUNK_COMPONENT;
      this.emit('completedChunkEvent', {
        taskId: this.options.taskId,
        successfulCount: this._finishSuccessCount,
        totalCount: this._chunks.length,
        category: this.options.category,
        status: 'completed',
      });
      this.emit('nextEvent');
      // ???????????????????????????????????????
      this.loopFileResult();
    }
    
  }

  async run(params?: any) {
    const { isRetry, retrySuccessfulCount, chunks } = params || {};

    const subChunks = chunks || this._chunks;
    const fetchPromise = this._promiseFetchs(
      subChunks,
      isRetry,
      retrySuccessfulCount,
    );
    const results = await Promise.allSettled(fetchPromise);
    // ??????????????????
    const errorChunkList: ChunkFile[] = [];
    results.forEach((result: any, index) => {
      const { status, value, reason } = result;
   
      if (status === 'fulfilled') {
        if (value.status !== 'ok') {
          errorChunkList.push(subChunks[index]);
        }
      } else if(status === 'rejected' && reason?.type !== 'AbortError') {
        errorChunkList.push(subChunks[index]);
      }
    });
    console.log('errorChunkList', errorChunkList);

    if (errorChunkList.length && this.retry < this.options.retryCount) {
      // ????????????
      console.log('retry', this.retry);
      this.retry += 1;

      this.run({
        isRetry,
        retrySuccessfulCount,
        chunks: errorChunkList,
      });
    } else {
      // ?????? ????????????(???????????????) ???chunk??????
      this.runEnd(errorChunkList);
    }
  }

  /**
   * ???????????????????????? ???????????????????????????????????????????????????????????????
     ??????????????????????????? ??????????????????????????????????????????
     ?????????????????????????????????????????? ?????????????????????????????????????????????????????????????????????????????????
     ??????????????????????????? ??? ??????????????????
   */
  // ????????????
  async _waitToLoop() {
    await delay(10 * 1000);
    this.loopFileResult()
  }

  async loopFileResult() {
    const totalLen = this._chunks.length;
    try {
      const result = await this.options.getChunksStatusApi({
        uploadTaskId: this.options.taskId,
        signal: this.controller?.signal,
      });
      if (result && result.status === 'ok') {
        const { uploadingStatusList, gatherFileFlag } = result.data;
        if (uploadingStatusList.length === totalLen) {
          // ????????????????????????????????? ??????????????????
          const mergedStatus = this._formatFileResultMerge(
            uploadingStatusList,
            gatherFileFlag,
            totalLen,
          );
          if (mergedStatus) {
            if (mergedStatus === FileStatus.MERGING) {
              this._waitToLoop();
              return
            }
            return;
          }

          this._formatFileResultChunk(uploadingStatusList, totalLen);
        } else {
          this._waitToLoop();
        }
      } else {
        throw new Error('???????????????????????????????????????');
      }
    } catch (error) {
      console.log(error);
      this._waitToLoop();
    }
  }

  // ????????????????????????
  // eslint-disable-next-line class-methods-use-this
  _formatSaveChunksStatus(uploadingStatusList: ChunksStatusContent[]) {
    const successfulArr: number[] = [];
    const errorArr: number[] = [];
    uploadingStatusList.forEach((item: ChunksStatusContent) => {
      if (item.uploadStatus === true) {
        successfulArr.push(item.sliceIndex);
      } else {
        errorArr.push(item.sliceIndex);
      }
    });
    return {
      successfulArr,
      errorArr,
    };
  }

  // ??????merge???????????????
  _formatFileResultMerge(
    uploadingStatusList: ChunksStatusContent[],
    gatherFileFlag: GatherFileFlag,
    totalLen: number,
  ) {
    
    let mergedStatus: FileStatus | '' = '';
    if (gatherFileFlag === GatherFileFlag.SUCCESS) {
      mergedStatus = FileStatus.MERGE_SUCCESSFUL;
    } else if (gatherFileFlag === GatherFileFlag.FAIL) {
      mergedStatus = FileStatus.MERGE_FAIL;
    } else if (gatherFileFlag === GatherFileFlag.GATHERING) {
      mergedStatus = FileStatus.MERGING;
    }

    if (mergedStatus) {
      const { successfulArr, errorArr } =
      this._formatSaveChunksStatus(uploadingStatusList);

      this.status = mergedStatus;
      this.emit('completedServerChunkStatusEvent', {
        taskId: this.options.taskId,
        total: totalLen,
        status: mergedStatus,
        successfulList: successfulArr,
        errorList: errorArr,
      });
    }
    return mergedStatus;
  }

  // ????????????????????????
  _formatFileResultChunk(
    uploadingStatusList: ChunksStatusContent[],
    totalLen: number,
  ) {
    const { successfulArr, errorArr } =
      this._formatSaveChunksStatus(uploadingStatusList);

    let status: FileStatus;
    if (errorArr.length) {
      status = FileStatus.SERVER_CHUNK_ERROR;
    } else {
      status = FileStatus.SERVER_CHUNK_SUCCESSFUL;
      this.loopFileResult();
    }
    this.status = status;
    this.emit('completedServerChunkStatusEvent', {
      taskId: this.options.taskId,
      total: totalLen,
      successfulList: successfulArr,
      errorList: errorArr,
      status,
    });
  }

  // ????????????????????????????????????
  async _getServerFileInfo(taskId: string, category: string) {
    try {
      const result = await this.options.getFileContinueInfoApi({
        uploadTaskId: taskId,
        category,
      });

      if (result && result.status === 'ok') {
        return result.data;
      }
      throw new Error(
        result && result.message ? result.message : '?????????????????????????????????',
      );
    } catch (error) {
      message.error(typeof error === 'string' ? error : '?????????????????????????????????,???????????????')
      return false;
    }
  }

  // ?????????????????????????????????????????????, ??????????????????????????????????????????
  async _changeUploadFile(taskId: string, category: string, id: number) {
    const data = await this.options.changeUploadFileApi({
      taskId,
      category,
      id,
    })
    if(data && data.status === 'ok') {
      return true
    }
    return false
  }

  // ????????? ??????
  async _originFileContinueUpload(data: any) {
    const { uploadInfo } = data;
    const { uploadingStatusList } = uploadInfo;
    const { successfulArr } = this._formatSaveChunksStatus(uploadingStatusList);
    const fileSlice = await toErrorFileSlice(
      this.options.file,
      this.options.chunkSize,
      successfulArr,
    );

    this.run({
      isRetry: true,
      retrySuccessfulCount: successfulArr.length,
      chunks: fileSlice,
    });
  }

  // cancel ????????????
  cancel() {
    this.status = FileStatus.DELETE;
    this.plimit.clear();
    if (this.controller) {
      
      this.controller.abort();
      this.controller = null;
    }
  }

  // ???????????????
  resetCountProperty() {
    this.retryFullFileCount = 0;
    this.retryChunkStatusCount = 0;
    this.retry = 0;
  }

  
  // ?????????
  async init() {
    // ????????????MD5??????worker????????????
    this._worker.postMessage({
      file: this.options.file,
      chunkSize: this.options.chunkSize,
    });
  }

  // ??????
  async initRun() {
    this.status = FileStatus.RUNNING;
    const chunks = await this._toSliceChunk();
    this._chunks = chunks;
    console.log('chunks', chunks);
    this.run();
  }

  // ???????????????????????????????????? ?????????
  async reInit() {
    this.resetCountProperty();
    if (!this._filemd5 || this._filemd5Status === '') {
      this.init();
    } else if (this._filemd5Status === 'error') {
      this._submitFullFillInfo(this._filemd5);
    }
    try {
      const data = await this._getServerFileInfo(
        this.options.taskId,
        this.options.category,
      );

      if (data) {
        // ??????
        this._originFileContinueUpload(data);
      } else {
        console.log('????????????????????????');
      }
    } catch (error) {
      console.log(error);
      message.error('??????????????????????????????????????????');
      
    }
  }

  // ??????????????? ???????????? ?????????
  reFileInit() {
    this.resetCountProperty();
  }

  // ??????????????? ???????????? ??????
  async reFileRun() {
    // ??????????????????????????????
    const { taskId, category, id} = this.options;
    let data = null;
    try {
      data = await this._getServerFileInfo(
        taskId,
        category,
      );
      if (!data) {
        throw new Error('????????????????????????');
      } 
    } catch (error) {
      message.error('??????????????????????????????????????????');
      data = null;
    }

    if(!data) {
      return
    }
    
    const isSameFile = data.md5 === this._filemd5;
    if (isSameFile) {
      // ??????
      this._originFileContinueUpload(data);
      
    } else {
      
      // ??????????????????
      const result = await this._changeUploadFile(taskId, category, id);

      if(result) {
        this._submitFullFillInfo(this._filemd5);
        this.initRun();
      } else {
        message.error('???????????????????????????????????????')
        
      }
    }
  }
}
