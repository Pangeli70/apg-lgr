/** -----------------------------------------------------------------------
 * @module [Lgr]
 * @author [APG] ANGELI Paolo Giusto
 * @version 0.5.1 [APG 2019/03/24]
 * @version 0.7.0 [APG 2019/08/15]
 * @version 0.8.0 [APG 2022/03/19] Porting to Deno
 * @version 0.9.0 [APG 2022/08/09] Code smells and metrics
 * @version 0.9.1 [APG 2022/09/24] Github Beta
 * -----------------------------------------------------------------------
 */

import {
  Rst, StdPath, Uts
} from "../../deps.ts"


import { IApgLgr } from "../interfaces/IApgLgr.ts";
import { ApgLgrLogsService } from "./ApgLgrLogsService.ts";



/**
 * Service to browse and purge logs from File System
 */
export class ApgLgrLogsFsService extends ApgLgrLogsService {


  private _dataFolder: string;


  constructor(adataFolder: string) {

    super(import.meta.url);

    this._dataFolder = adataFolder;

  }


  async loadSessions() {

    this._sessions = this.#readLogSessionsFromDiskSync();

    this.sortSessionsDescending();

    //return new Promise((resolve) => resolve(fs.readFileSync(filePath, { 'encoding': 'utf8' })));
    const r = new Promise<Rst.ApgRst>((resolve) => resolve(new Rst.ApgRst()));
    return await r;
  }


  #readLogSessionsFromDiskSync() {

    const r = Uts.ApgUtsFs.GetFileNamesSortedSync(this._dataFolder!, '.log')
    return r;

  }

  async loadLoggersFromSessionIndex(asessionIndex: number) {

    if (!this.IsReady) {
      await this.loadSessions();
    }

    return await this.#loadLoggersFromFile(asessionIndex);
  }


  async #loadLoggersFromFile(asessionIndex: number) {

    const file = StdPath.resolve(this._dataFolder + "/" + this._sessions[asessionIndex]);

    const fileExists = Uts.ApgUtsFs.FileExistsSync(file);
    Rst.ApgRstAssert.IsFalse(
      fileExists,
      `${this.CLASS_NAME}.${this.#loadLoggersFromFile.name}: file [${file}] does not exist!`
    )

    const rawJson = "[" + await Deno.readTextFile(file) + "]";

    const json = JSON.parse(rawJson);

    const r = json as IApgLgr[];

    return r;
  }

  async purgeOldSessions(akeepTheLast: number) {

    const r = await this.#purgeSessionFilesFromDisk(akeepTheLast);
    return r;
  }


  async #purgeSessionFilesFromDisk(akeepTheLastN: number) {

    if (!this.IsReady) {
      await this.loadSessions();
    }

    let r = new Rst.ApgRst();

    try {
      await this.#removeSessionFiles(akeepTheLastN);
    } catch (_error) {
      r = Rst.ApgRstErrors.Unmanaged('Error purging old session files:' + _error.message);
    }

    return r;
  }


  async #removeSessionFiles(akeepTheLastN: number) {

    const end = akeepTheLastN - 1;
    const begin = this._sessions.length - 1
    for (let i = begin; i > end; i--) {
      const afile = StdPath.resolve(this._dataFolder + "/" + this._sessions[i]);
      await Deno.remove(afile);
      console.log("Deleted session file: " + afile)
      this._sessions.pop();
    }
  }


}
