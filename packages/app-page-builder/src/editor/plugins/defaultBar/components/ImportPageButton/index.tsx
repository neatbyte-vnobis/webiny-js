import React from "react";
import { FileManager } from "@webiny/app-admin/components";
import { FileManagerProps } from "@webiny/app-admin/components/FileManager";

interface WrapperWithFileUploadProps extends Pick<FileManagerProps, "children"> {
    onSelect: (file: string) => void;
}
export const WrapperWithFileUpload: React.FC<WrapperWithFileUploadProps> = ({
    children,
    onSelect
}) => {
    return (
        <FileManager
            onChange={files => {
                const file = Array.isArray(files) ? files[0] : files;
                onSelect(file.key);
            }}
            onUploadCompletion={uploadedFiles => {
                if (!uploadedFiles || uploadedFiles.length === 0) {
                    return;
                }
                const zipKey = uploadedFiles[0].key;
                onSelect(zipKey);
            }}
            accept={["application/zip"]}
        >
            {({ showFileManager }) =>
                typeof children === "function"
                    ? children({ showFileManager })
                    : React.cloneElement(children as unknown as React.ReactElement, {
                          onClick: showFileManager
                      })
            }
        </FileManager>
    );
};
