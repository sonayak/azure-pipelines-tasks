"use strict";

import * as fs from "fs";
import * as tl from "azure-pipelines-task-lib/task";
import * as path from "path";

// http://www.daveeddy.com/2013/03/26/synchronous-file-io-in-nodejs/
// We needed a true Sync file write for config file
export function writeFileSync(filePath: string, data: string): number {
    try
    {
        const fd = fs.openSync(filePath, 'w');
        var bitesWritten = fs.writeSync(fd, data);
        fs.fsyncSync(fd);
        tl.debug(tl.loc("FileContentSynced", data));
        fs.closeSync(fd);
        return bitesWritten;
    } catch(e)
    {
        tl.error(tl.loc('CantWriteDataToFile', filePath, e));
        throw e;
    }
}

export function findDockerFile(dockerfilepath: string): string {
    if (dockerfilepath.indexOf('*') >= 0 || dockerfilepath.indexOf('?') >= 0) {
        tl.debug(tl.loc('ContainerPatternFound'));
        let workingDirectory = tl.getVariable('System.DefaultWorkingDirectory');
        let filePath: string = findMatchingFile(dockerfilepath, workingDirectory);
        tl.debug("Found file using glob:"+filePath);
        //The following fallback to TaskLib find should not be hit in most scenarios
        //But this is added as a fail safe as TaskLib find handles symlinks and other cases
        return filePath || findDockerFileUsingTaskLib(dockerfilepath, workingDirectory);
    }
    else {
        tl.debug(tl.loc('ContainerPatternNotFound'));
        return dockerfilepath;
    }
}

function findDockerFileUsingTaskLib(dockerfilepath: string, workingDirectory: string): string {
    tl.debug("Finding dockerfile using tasklib find");
    let allFiles = tl.find(workingDirectory);
    let matchingResultsFiles = tl.match(allFiles, dockerfilepath, workingDirectory, { matchBase: true });
    if (!matchingResultsFiles || matchingResultsFiles.length == 0) {
        throw new Error(tl.loc('ContainerDockerFileNotFound', dockerfilepath));
    }
    return matchingResultsFiles[0];
}

function validateWorkingDirectory(workingDirectory: string): string {
    try {
        let workingDirStats = fs.lstatSync(workingDirectory);
        if(!workingDirStats.isDirectory()){
            throw new Error("The specified working directory is not a valid directory");
        }
    }
    catch (err) {
        if (err.code == 'ENOENT') {
            return null;
        }
        throw err;
    }
}

/**
 * This is a custom and lightweight function to find matching file in a specified directory.
 * tl.find, tl.match and tl.findMatch methods are recommended for the use case.
 * This method uses tl.match internally for pattern matching. But the method avoids full directory traversal
 *  if it finds a single file matching the pattern.
 * This method does BFS to traverses the directory using a queue unlike tl.find and tl.findMatch
 *  which does DFS using a stack. 
 * This method is efficient for the usecase of finding a Dockerfile inside a source repo directory.
 * Currently it does not handle symlinks.
 * @param filePathPattern Specifies the pattern of the file path to match
 * @param workingDirectory Specifies the working directory to start search from
 */
function findMatchingFile(filePathPattern: string, workingDirectory: string): string {
    tl.debug(workingDirectory);
    workingDirectory = path.normalize(workingDirectory);
    tl.debug(workingDirectory);
    validateWorkingDirectory(workingDirectory);
    let queue: string[] = [];
    queue.push(workingDirectory);
    while(queue.length>0){
        let currentPath: string = queue.shift()!;
        tl.debug(currentPath);
        let childItems: string[] =
                fs.readdirSync(currentPath)
                    .map((childName: string) => path.join(currentPath, childName));
        let filePaths: string[] = [];
        for (var i = childItems.length - 1; i >= 0; i--) {
            let childStats = fs.lstatSync(childItems[i]);
            if(childStats.isDirectory()){
                tl.debug(`directory:${childItems[i]}`);
                queue.push(childItems[i]);
            } else if(childStats.isFile()){
                tl.debug(`file:${childItems[i]}`);
                filePaths.push(childItems[i]);
            }
        }
        //check if any files in the current directory matches with the pattern
        if(filePaths.length>0){
            let matchingResultsFiles = tl.match(filePaths,filePathPattern,workingDirectory,{ matchBase: true });
            if(matchingResultsFiles && matchingResultsFiles.length>0){
                tl.debug("found matching:"+matchingResultsFiles[0]);
                return matchingResultsFiles[0];
            }
        }
    }
    return null;
}